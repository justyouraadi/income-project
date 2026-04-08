from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, Request, UploadFile, File
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import random
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict
import uuid
from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt
import secrets
from bson import ObjectId
import resend
import httpx
import hmac
import hashlib
import json
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)

# Get database name - try from env, then extract from connection string, then default
db_name = os.environ.get('DB_NAME')
if not db_name:
    # Try to extract database name from MongoDB URL
    # Atlas URLs look like: mongodb+srv://user:pass@cluster.mongodb.net/dbname?options
    from urllib.parse import urlparse
    parsed = urlparse(mongo_url.replace('mongodb+srv://', 'https://').replace('mongodb://', 'https://'))
    path_db = parsed.path.strip('/').split('?')[0]
    db_name = path_db if path_db else 'ss_money_resource'
db = client[db_name]
logging.info(f"Connected to MongoDB database: {db_name}")

# Resend Email Configuration
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY

# NOWPayments Configuration
NOWPAYMENTS_API_KEY = os.environ.get("NOWPAYMENTS_API_KEY", "")
NOWPAYMENTS_IPN_SECRET = os.environ.get("NOWPAYMENTS_IPN_SECRET", "")
NOWPAYMENTS_API_BASE_URL = "https://api.nowpayments.io/v1"

# In-memory OTP storage (for production, use Redis or DB)
otp_storage: Dict[str, dict] = {}

# ==================== FIXED LEVEL INCOME SLABS ====================
# Level Income is based on USER's TEAM TOTAL INVESTMENT (sum of all downline investments)
# When team members earn Daily ROI, the upline receives a percentage of that ROI
# based on their team's total investment slab (NOT editable per plan - these are fixed)
# 1 lakh = 100,000 USD
LEVEL_INCOME_SLABS = [
    {"min": 1000, "max": 5000, "percent": 5},       # Level 1: Team investment $1,000 - $5,000 → 5%
    {"min": 5000, "max": 10000, "percent": 10},     # Level 2: Team investment $5,000 - $10,000 → 10%
    {"min": 10000, "max": 25000, "percent": 15},    # Level 3: Team investment $10,000 - $25,000 → 15%
    {"min": 25000, "max": 50000, "percent": 20},    # Level 4: Team investment $25,000 - $50,000 → 20%
    {"min": 50000, "max": 100000, "percent": 25},   # Level 5: Team investment $50,000 - $1 lakh → 25%
    {"min": 100000, "max": 200000, "percent": 30},  # Level 6: Team investment $1 lakh - $2 lakh → 30%
    {"min": 200000, "max": 500000, "percent": 35},  # Level 7: Team investment $2 lakh - $5 lakh → 35%
    {"min": 500000, "max": 1000000, "percent": 40}, # Level 8: Team investment $5 lakh - $10 lakh → 40%
    {"min": 1000000, "max": float('inf'), "percent": 45},  # Level 9+: Team investment $10 lakh+ → 45%
]

def get_level_income_percent(team_total_investment: float) -> float:
    """
    Get the level income percentage based on user's TEAM total investment amount.
    Returns 0 if team investment is below minimum threshold ($1,000).
    """
    if team_total_investment < 1000:
        return 0
    
    for slab in LEVEL_INCOME_SLABS:
        if slab["min"] <= team_total_investment < slab["max"]:
            return slab["percent"]
    
    # If above all slabs (shouldn't happen due to infinity), return max
    return 45


async def calculate_team_total_investment(user_id: str) -> float:
    """
    Calculate the total investment of a user's entire team (all downlines).
    This recursively sums up investments from all levels of the referral tree.
    """
    total = 0
    
    # Get all direct referrals
    direct_referrals = await db.users.find({"referred_by": user_id}).to_list(1000)
    
    for referral in direct_referrals:
        # Get this referral's wallet to get their investment
        wallet = await db.wallets.find_one({"user_id": referral["id"]})
        if wallet:
            total += wallet.get("total_invested", 0)
        
        # Recursively get their team's investment
        total += await calculate_team_total_investment(referral["id"])
    
    return total

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET_KEY = os.environ.get("SECRET_KEY", secrets.token_urlsafe(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30 * 24 * 60  # 30 days

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# ==================== HEALTH CHECK ====================

@app.get("/health")
async def health_check():
    """Health check endpoint for Kubernetes"""
    try:
        # Check MongoDB connection
        await client.admin.command('ping')
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": str(e)}

@app.get("/")
async def root():
    """Root endpoint - redirect to website"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/api/website/")

@api_router.get("/level-income-slabs")
async def get_level_income_slabs():
    """
    Get the fixed level income slabs information.
    Level income is based on user's TEAM TOTAL INVESTMENT (sum of all downline investments).
    When team members earn Daily ROI, uplines receive a percentage based on their team's investment slab.
    """
    return {
        "description": "Level income is a percentage of your team's Daily ROI based on your TEAM's total investment",
        "slabs": [
            {"level": 1, "min_investment": 1000, "max_investment": 5000, "percent": 5, "label": "Team Investment $1,000 - $5,000"},
            {"level": 2, "min_investment": 5000, "max_investment": 10000, "percent": 10, "label": "Team Investment $5,000 - $10,000"},
            {"level": 3, "min_investment": 10000, "max_investment": 25000, "percent": 15, "label": "Team Investment $10,000 - $25,000"},
            {"level": 4, "min_investment": 25000, "max_investment": 50000, "percent": 20, "label": "Team Investment $25,000 - $50,000"},
            {"level": 5, "min_investment": 50000, "max_investment": 100000, "percent": 25, "label": "Team Investment $50,000 - $1 Lakh"},
            {"level": 6, "min_investment": 100000, "max_investment": 200000, "percent": 30, "label": "Team Investment $1 Lakh - $2 Lakh"},
            {"level": 7, "min_investment": 200000, "max_investment": 500000, "percent": 35, "label": "Team Investment $2 Lakh - $5 Lakh"},
            {"level": 8, "min_investment": 500000, "max_investment": 1000000, "percent": 40, "label": "Team Investment $5 Lakh - $10 Lakh"},
            {"level": 9, "min_investment": 1000000, "max_investment": None, "percent": 45, "label": "Team Investment $10 Lakh & Above (up to Level 20)"}
        ],
        "notes": [
            "Minimum TEAM investment of $1,000 required to earn level income",
            "Level income applies up to 20 levels deep in your team",
            "Only distributed when team members earn Daily ROI",
            "These percentages are fixed and cannot be changed per plan",
            "Team investment = sum of all your downline's investments"
        ]
    }

# ==================== MODELS ====================

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    referral_code: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class User(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    referral_code: str
    referred_by: Optional[str] = None
    created_at: datetime

class Wallet(BaseModel):
    user_id: str
    daily_roi: float = 0.0
    direct_income: float = 0.0
    level_income: float = 0.0  # Total level income from downline investments (Levels 1-20)
    slab_income: float = 0.0
    royalty_income: float = 0.0
    salary_income: float = 0.0
    total_balance: float = 0.0
    total_invested: float = 0.0
    last_roi_date: Optional[datetime] = None

class Investment(BaseModel):
    id: str
    user_id: str
    amount: float
    date: datetime
    status: str  # active, completed
    plan: Optional[str] = "premium"
    validity_days: Optional[int] = 100
    end_date: Optional[datetime] = None

class InvestRequest(BaseModel):
    amount: float
    plan: Optional[str] = "premium"
    cryptocurrency: Optional[str] = "usdtbsc"  # Default to USDT BSC Network

class Transaction(BaseModel):
    id: str
    user_id: str
    type: str  # investment, roi, direct_income, slab_income, royalty_income, withdrawal
    amount: float
    description: str
    date: datetime

class ReferralIncome(BaseModel):
    id: str
    user_id: str
    referred_user_id: str
    amount: float
    date: datetime

class TeamMember(BaseModel):
    user_id: str
    full_name: str
    email: str
    joined_date: datetime
    total_investment: float
    level: int

class DashboardStats(BaseModel):
    total_net_worth: float
    daily_roi: float
    total_referrals: int
    total_team_members: int
    direct_income: float
    level_income: float

# ==================== SUPPORT TICKET MODELS ====================

class TicketCreate(BaseModel):
    subject: str
    category: str  # general, investment, withdrawal, referral, technical, other
    message: str
    priority: Optional[str] = "normal"  # low, normal, high

class TicketReply(BaseModel):
    message: str

class TicketStatusUpdate(BaseModel):
    status: str  # open, in_progress, resolved, closed

# ==================== LEARNING CENTER MODELS ====================

class VideoCreate(BaseModel):
    title: str
    youtube_url: str
    description: Optional[str] = ""
    category: str = "other"
    display_order: int = 0
    is_active: bool = True

class VideoUpdate(BaseModel):
    title: Optional[str] = None
    youtube_url: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None

# ==================== AUTH UTILITIES ====================

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def generate_referral_code():
    return secrets.token_urlsafe(6).upper()[:8]

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = await db.users.find_one({"id": user_id})
    if user is None:
        raise credentials_exception
    return user

# ==================== AUTH ROUTES ====================

@api_router.get("/auth/lookup-referrer/{code}")
async def lookup_referrer(code: str):
    """Look up a referrer by referral code or user number (format: 01SSMR)"""
    # Remove # prefix if present
    clean_code = code.lstrip('#').strip()
    
    # Try to find by user_number (format: 01SSMR, 02SSMR, etc.)
    # Check if code ends with SSMR (case insensitive)
    if clean_code.upper().endswith('SSMR'):
        referrer = await db.users.find_one({"user_number": clean_code.upper()})
        if referrer:
            return {
                "found": True,
                "name": referrer["full_name"],
                "user_number": referrer["user_number"],
                "referral_code": referrer["referral_code"]
            }
    
    # Try to find by referral_code
    referrer = await db.users.find_one({"referral_code": clean_code.upper()})
    if referrer:
        return {
            "found": True,
            "name": referrer["full_name"],
            "user_number": referrer.get("user_number"),
            "referral_code": referrer["referral_code"]
        }
    
    # Also try lowercase
    referrer = await db.users.find_one({"referral_code": clean_code})
    if referrer:
        return {
            "found": True,
            "name": referrer["full_name"],
            "user_number": referrer.get("user_number"),
            "referral_code": referrer["referral_code"]
        }
    
    return {"found": False, "message": "Referrer not found"}

@api_router.post("/auth/register", response_model=Token)
async def register(user_data: UserCreate):
    # Check if user exists
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Validate referral code if provided
    referrer = None
    if user_data.referral_code:
        # Remove # prefix if present
        clean_code = user_data.referral_code.lstrip('#').strip()
        
        # Try to find by user_number (format: 01SSMR, 02SSMR, etc.)
        if clean_code.upper().endswith('SSMR'):
            referrer = await db.users.find_one({"user_number": clean_code.upper()})
        
        # If not found by user_number, try by referral_code
        if not referrer:
            referrer = await db.users.find_one({"referral_code": clean_code.upper()})
        if not referrer:
            referrer = await db.users.find_one({"referral_code": clean_code})
        
        if not referrer:
            raise HTTPException(status_code=400, detail="Invalid referral code")
    
    # Generate unique user number in format: 01SSMR, 02SSMR, etc.
    last_user = await db.users.find_one(sort=[("user_seq", -1)])
    user_seq = (last_user.get("user_seq", 0) + 1) if last_user else 1
    user_number = f"{user_seq:02d}SSMR"  # Format: 01SSMR, 02SSMR, etc.
    
    # Create user
    user_id = str(uuid.uuid4())
    hashed_password = get_password_hash(user_data.password)
    referral_code = generate_referral_code()
    
    user = {
        "id": user_id,
        "user_seq": user_seq,  # Sequential number for generating user_number
        "user_number": user_number,  # Display format: 01SSMR, 02SSMR, etc.
        "email": user_data.email,
        "password": hashed_password,
        "full_name": user_data.full_name,
        "referral_code": referral_code,
        "referred_by": referrer["id"] if referrer else None,
        "status": "inactive",  # inactive until first investment
        "created_at": datetime.utcnow()
    }
    
    await db.users.insert_one(user)
    
    # Create wallet for user
    wallet = {
        "user_id": user_id,
        "daily_roi": 0.0,
        "direct_income": 0.0,
        "level_income": 0.0,  # Level income from downline (Levels 1-20)
        "slab_income": 0.0,
        "royalty_income": 0.0,
        "salary_income": 0.0,
        "withdrawal_balance": 0.0,  # Withdrawal wallet
        "total_balance": 0.0,
        "total_invested": 0.0,
        "total_withdrawn": 0.0,
        "last_roi_date": None
    }
    await db.wallets.insert_one(wallet)
    
    # Create access token
    access_token = create_access_token(data={"sub": user_id})
    
    return {"access_token": access_token, "token_type": "bearer"}

@api_router.post("/auth/login", response_model=Token)
async def login(user_data: UserLogin):
    """User login - rejects admin accounts"""
    user = await db.users.find_one({"email": user_data.email})
    if not user or not verify_password(user_data.password, user["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    # Reject admin accounts on user login
    if user.get("is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin accounts cannot login here. Please use the Admin Panel."
        )
    
    access_token = create_access_token(data={"sub": user["id"]})
    return {"access_token": access_token, "token_type": "bearer"}

@api_router.post("/auth/admin-login", response_model=Token)
async def admin_login(user_data: UserLogin):
    """Admin login - only accepts admin accounts"""
    user = await db.users.find_one({"email": user_data.email})
    if not user or not verify_password(user_data.password, user["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    # Only allow admin accounts
    if not user.get("is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Admin account required."
        )
    
    access_token = create_access_token(data={"sub": user["id"]})
    return {"access_token": access_token, "token_type": "bearer"}

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    # Get wallet data for investment/balance info
    wallet = await db.wallets.find_one({"user_id": current_user["id"]})
    total_invested = wallet.get("total_invested", 0) if wallet else 0
    
    # Get team size (count of direct referrals)
    team_size = await db.users.count_documents({"referred_by": current_user["id"]})
    
    # Get total withdrawn
    total_withdrawn = await db.withdrawals.aggregate([
        {"$match": {"user_id": current_user["id"], "status": "approved"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    withdrawn_amount = total_withdrawn[0]["total"] if total_withdrawn else 0
    
    return {
        "id": current_user["id"],
        "email": current_user["email"],
        "full_name": current_user["full_name"],
        "referral_code": current_user["referral_code"],
        "referred_by": current_user.get("referred_by"),
        "created_at": current_user["created_at"],
        "is_admin": current_user.get("is_admin", False),
        "user_number": current_user.get("user_number"),
        "status": current_user.get("status", "active"),
        "total_investment": total_invested,
        "total_withdrawn": withdrawn_amount,
        "team_size": team_size,
        "joined_date": current_user.get("created_at"),
        "profile_picture": current_user.get("profile_picture")
    }


# ==================== USER PROFILE ROUTES ====================

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None

@api_router.put("/user/profile")
async def update_profile(profile_data: ProfileUpdate, current_user: dict = Depends(get_current_user)):
    """Update user profile (name, email, password)"""
    update_fields = {}
    
    if profile_data.full_name:
        update_fields["full_name"] = profile_data.full_name
    
    if profile_data.email:
        # Check if email is already taken by another user
        existing_user = await db.users.find_one({
            "email": profile_data.email,
            "id": {"$ne": current_user["id"]}
        })
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already in use")
        update_fields["email"] = profile_data.email
    
    if profile_data.password:
        if len(profile_data.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        update_fields["hashed_password"] = pwd_context.hash(profile_data.password)
    
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": update_fields}
    )
    
    return {"message": "Profile updated successfully"}


@api_router.post("/user/profile/picture")
async def upload_profile_picture(file: UploadFile, current_user: dict = Depends(get_current_user)):
    """Upload profile picture (stored as base64)"""
    # Validate file type
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Read file content
    content = await file.read()
    
    # Check file size (max 2MB)
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image size must be less than 2MB")
    
    # Convert to base64 data URL
    import base64
    base64_content = base64.b64encode(content).decode('utf-8')
    data_url = f"data:{file.content_type};base64,{base64_content}"
    
    # Save to user record
    await db.users.update_one(
        {"id": current_user["id"]},
        {"$set": {"profile_picture": data_url}}
    )
    
    return {"message": "Profile picture updated", "profile_picture": data_url}


# ==================== INVESTMENT PLANS ROUTES (Admin CRUD) ====================

class InvestmentPlanCreate(BaseModel):
    name: str
    daily_roi: float  # e.g., 1.0 for 1%
    total_return: float = 2.0  # e.g., 2.0 for 2x return
    direct_income: float = 5.0  # Direct referral income percentage
    min_investment: float = 20.0
    max_investment: Optional[float] = None
    validity_days: int = 100
    description: Optional[str] = None
    is_active: bool = True

class InvestmentPlanUpdate(BaseModel):
    name: Optional[str] = None
    daily_roi: Optional[float] = None
    total_return: Optional[float] = None
    direct_income: Optional[float] = None
    min_investment: Optional[float] = None
    max_investment: Optional[float] = None
    validity_days: Optional[int] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


@api_router.get("/investment-plans")
async def get_investment_plans():
    """Get all active investment plans (public endpoint for users)"""
    plans = await db.investment_plans.find({"is_active": True}).sort("daily_roi", -1).to_list(100)
    
    # If no plans exist, return default plans
    if not plans:
        default_plans = [
            {"id": "premium", "name": "Premium Plan", "daily_roi": 1.0, "total_return": 2.0, "direct_income": 5.0, "min_investment": 20, "validity_days": 100, "is_active": True},
            {"id": "regular", "name": "Regular Plan", "daily_roi": 0.5, "total_return": 1.5, "direct_income": 5.0, "min_investment": 20, "validity_days": 100, "is_active": True}
        ]
        return default_plans
    
    # Convert ObjectId to string for JSON serialization
    for plan in plans:
        if "_id" in plan:
            del plan["_id"]
    
    return plans


@api_router.get("/admin/investment-plans")
async def admin_get_all_plans(current_user: dict = Depends(get_current_user)):
    """Get all investment plans (admin only)"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    plans = await db.investment_plans.find().sort("created_at", -1).to_list(100)
    
    for plan in plans:
        if "_id" in plan:
            del plan["_id"]
    
    return plans


@api_router.post("/admin/investment-plans")
async def create_investment_plan(plan: InvestmentPlanCreate, current_user: dict = Depends(get_current_user)):
    """Create a new investment plan (admin only)"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    new_plan = {
        "id": str(uuid.uuid4()),
        "name": plan.name,
        "daily_roi": plan.daily_roi,
        "total_return": plan.total_return,
        "direct_income": plan.direct_income,
        "min_investment": plan.min_investment,
        "max_investment": plan.max_investment,
        "validity_days": plan.validity_days,
        "description": plan.description,
        "is_active": plan.is_active,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    await db.investment_plans.insert_one(new_plan)
    del new_plan["_id"]
    
    return {"message": "Investment plan created", "plan": new_plan}


@api_router.put("/admin/investment-plans/{plan_id}")
async def update_investment_plan(plan_id: str, plan_update: InvestmentPlanUpdate, current_user: dict = Depends(get_current_user)):
    """Update an investment plan (admin only)"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    existing_plan = await db.investment_plans.find_one({"id": plan_id})
    if not existing_plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    update_data = {k: v for k, v in plan_update.dict().items() if v is not None}
    update_data["updated_at"] = datetime.utcnow()
    
    await db.investment_plans.update_one(
        {"id": plan_id},
        {"$set": update_data}
    )
    
    return {"message": "Plan updated successfully"}


@api_router.delete("/admin/investment-plans/{plan_id}")
async def delete_investment_plan(plan_id: str, current_user: dict = Depends(get_current_user)):
    """Delete an investment plan (admin only)"""
    if not current_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.investment_plans.delete_one({"id": plan_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    return {"message": "Plan deleted successfully"}

# ==================== WALLET ROUTES ====================

@api_router.get("/wallet", response_model=Wallet)
async def get_wallet(current_user: dict = Depends(get_current_user)):
    wallet = await db.wallets.find_one({"user_id": current_user["id"]})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    return wallet

@api_router.post("/wallet/invest")
async def create_investment(request: InvestRequest, current_user: dict = Depends(get_current_user)):
    """Create investment via NOWPayments crypto gateway using Invoice API for hosted checkout"""
    amount = request.amount
    plan = request.plan
    cryptocurrency = request.cryptocurrency or "btc"
    
    if amount < 20:
        raise HTTPException(status_code=400, detail="Minimum investment is $20")
    
    if not NOWPAYMENTS_API_KEY:
        raise HTTPException(status_code=500, detail="Payment gateway not configured")
    
    # Generate unique IDs for tracking
    investment_id = str(uuid.uuid4())
    order_id = f"INV-{investment_id[:8].upper()}"
    
    # Get base URL for callbacks (using frontend URL since it's publicly accessible)
    base_url = "https://ssmoneyresource.tech"
    webhook_url = f"{base_url}/api/webhooks/nowpayments"
    success_url = f"{base_url}/api/user/#dashboard?payment=success&investment_id={investment_id}"
    cancel_url = f"{base_url}/api/user/#invest?payment=cancelled"
    
    try:
        # Create INVOICE via NOWPayments API (for hosted checkout page)
        async with httpx.AsyncClient() as client:
            invoice_payload = {
                "price_amount": amount,
                "price_currency": "usd",
                "order_id": order_id,
                "order_description": f"Investment of ${amount} USD - {plan} plan",
                "ipn_callback_url": webhook_url,
                "success_url": success_url,
                "cancel_url": cancel_url,
                "is_fixed_rate": False,
                "is_fee_paid_by_user": False
            }
            
            response = await client.post(
                f"{NOWPAYMENTS_API_BASE_URL}/invoice",
                json=invoice_payload,
                headers={"x-api-key": NOWPAYMENTS_API_KEY}
            )
            
            if response.status_code != 200 and response.status_code != 201:
                logging.error(f"NOWPayments invoice error: {response.text}")
                raise HTTPException(status_code=500, detail=f"Payment gateway error: {response.text}")
            
            invoice_data = response.json()
            logging.info(f"NOWPayments invoice created: {invoice_data}")
        
        # Create pending investment record
        pending_investment = {
            "id": investment_id,
            "user_id": current_user["id"],
            "amount": amount,
            "plan": plan,
            "cryptocurrency": cryptocurrency,
            "order_id": order_id,
            "nowpayments_invoice_id": invoice_data.get("id"),
            "invoice_url": invoice_data.get("invoice_url"),
            "date": datetime.utcnow(),
            "status": "pending_payment",  # Will change to "active" after payment confirmation
            "validity_days": 100
        }
        await db.investments.insert_one(pending_investment)
        
        # Create pending transaction record
        pending_transaction = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["id"],
            "type": "investment_pending",
            "amount": amount,
            "description": f"Pending crypto investment of ${amount} via {cryptocurrency.upper()}",
            "date": datetime.utcnow(),
            "investment_id": investment_id
        }
        await db.transactions.insert_one(pending_transaction)
        
        # Return invoice details to frontend - use the invoice_url from NOWPayments
        return {
            "message": "Payment initiated",
            "investment_id": investment_id,
            "invoice_id": invoice_data.get("id"),
            "price_amount": amount,
            "price_currency": "usd",
            "status": "pending_payment",
            # Use the invoice_url directly from NOWPayments response
            "checkout_url": invoice_data.get("invoice_url")
        }
        
    except httpx.HTTPError as e:
        logging.error(f"HTTP error creating invoice: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment gateway connection error")
    except Exception as e:
        logging.error(f"Error creating investment: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== NOWPAYMENTS WEBHOOK ====================

async def distribute_level_income_from_roi(user_id: str, roi_amount: float, source_user_name: str):
    """
    Distribute level income to upline users (up to 20 levels) when a team member earns Daily ROI.
    The percentage is based on the UPLINE's TEAM TOTAL INVESTMENT (slab-based, fixed).
    
    Args:
        user_id: The ID of the user who earned the ROI
        roi_amount: The ROI amount earned by the team member
        source_user_name: Name of the user who earned ROI (for transaction description)
    
    Returns:
        List of distributions made
    """
    distributions = []
    
    # Get the user who earned ROI
    current_user = await db.users.find_one({"id": user_id})
    if not current_user:
        return distributions
    
    # Traverse up the referral chain (up to 20 levels)
    current_upline_id = current_user.get("referred_by")
    level = 1
    
    while current_upline_id and level <= 20:
        # Get the upline user
        upline_user = await db.users.find_one({"id": current_upline_id})
        
        if not upline_user:
            break
        
        # Only distribute to ACTIVE users
        if upline_user.get("status") != "active":
            # Move to next level but don't distribute
            current_upline_id = upline_user.get("referred_by")
            level += 1
            continue
        
        # Calculate upline's TEAM total investment (sum of all downline investments)
        team_total_investment = await calculate_team_total_investment(current_upline_id)
        
        # Get level income percentage based on upline's TEAM investment slab
        level_percent = get_level_income_percent(team_total_investment)
        
        if level_percent > 0:
            # Calculate level income amount (percentage of team member's ROI)
            income_amount = roi_amount * (level_percent / 100)
            
            # Update upline's wallet - use level_income field
            await db.wallets.update_one(
                {"user_id": current_upline_id},
                {
                    "$inc": {
                        "level_income": income_amount,
                        "total_balance": income_amount
                    }
                }
            )
            
            # Create transaction record
            level_transaction = {
                "id": str(uuid.uuid4()),
                "user_id": current_upline_id,
                "type": "level_income",
                "amount": income_amount,
                "description": f"Level {level} income ({level_percent}%) from {source_user_name}'s ROI",
                "date": datetime.utcnow(),
                "source_user_id": user_id,
                "level": level,
                "roi_amount": roi_amount,
                "percentage": level_percent,
                "team_total_investment": team_total_investment
            }
            await db.transactions.insert_one(level_transaction)
            
            distributions.append({
                "level": level,
                "user_id": current_upline_id,
                "user_name": upline_user.get("full_name", "Unknown"),
                "amount": income_amount,
                "percentage": level_percent,
                "team_total_investment": team_total_investment
            })
            
            logging.info(f"Level {level} income: ${income_amount:.4f} ({level_percent}%) credited to {upline_user['full_name']} (team investment ${team_total_investment})")
        
        # Move to next level
        current_upline_id = upline_user.get("referred_by")
        level += 1
    
    return distributions


@api_router.post("/webhooks/nowpayments")
async def handle_nowpayments_webhook(request: Request):
    """
    Webhook endpoint to receive payment status updates from NOWPayments.
    Verifies HMAC-SHA512 signature and processes payment confirmations.
    """
    try:
        # Get raw request body for signature verification
        raw_body = await request.body()
        
        # Get the signature from headers
        signature_header = request.headers.get("x-nowpayments-sig", "")
        
        # Log webhook receipt
        logging.info(f"Received NOWPayments webhook: {raw_body.decode()[:500]}")
        
        # Parse payload
        try:
            payload = json.loads(raw_body)
        except json.JSONDecodeError:
            logging.error("Invalid JSON in webhook payload")
            return JSONResponse(status_code=400, content={"error": "Invalid payload"})
        
        # Verify signature if IPN secret is configured
        if NOWPAYMENTS_IPN_SECRET and signature_header:
            sorted_payload = json.dumps(payload, sort_keys=True, separators=(',', ':'))
            expected_signature = hmac.new(
                NOWPAYMENTS_IPN_SECRET.encode(),
                sorted_payload.encode(),
                hashlib.sha512
            ).hexdigest()
            
            if not hmac.compare_digest(expected_signature, signature_header):
                logging.warning("Invalid webhook signature")
                # Still process but log the warning - some test webhooks may not be signed
        
        # Extract payment information (works for both payment and invoice webhooks)
        payment_id = payload.get("payment_id")
        invoice_id = payload.get("invoice_id")
        payment_status = payload.get("payment_status")
        order_id = payload.get("order_id")
        actually_paid = payload.get("actually_paid", 0)
        pay_currency = payload.get("pay_currency")
        
        logging.info(f"Webhook: payment_id={payment_id}, invoice_id={invoice_id}, status={payment_status}, order_id={order_id}")
        
        # Find the investment by nowpayments_invoice_id, order_id, or payment_id
        investment = await db.investments.find_one({
            "$or": [
                {"nowpayments_invoice_id": invoice_id},
                {"nowpayments_id": payment_id},
                {"order_id": order_id}
            ]
        })
        
        if not investment:
            logging.warning(f"No investment found for invoice_id={invoice_id}, payment_id={payment_id}, order_id={order_id}")
            return JSONResponse(status_code=200, content={"received": True, "warning": "No matching investment"})
        
        investment_id = investment["id"]
        user_id = investment["user_id"]
        amount = investment["amount"]
        
        # Handle payment status
        if payment_status == "finished":
            # Payment completed - activate the investment
            logging.info(f"Payment finished for investment {investment_id}")
            
            # Update investment status
            start_date = datetime.utcnow()
            end_date = start_date + timedelta(days=100)
            
            await db.investments.update_one(
                {"id": investment_id},
                {
                    "$set": {
                        "status": "active",
                        "date": start_date,
                        "end_date": end_date,
                        "actually_paid": actually_paid,
                        "payment_completed_at": datetime.utcnow()
                    }
                }
            )
            
            # Update user's wallet
            user = await db.users.find_one({"id": user_id})
            is_first_investment = user.get("status") == "inactive"
            
            await db.wallets.update_one(
                {"user_id": user_id},
                {
                    "$inc": {
                        "total_invested": amount,
                        "total_balance": amount
                    }
                }
            )
            
            # Activate user if first investment
            if is_first_investment:
                await db.users.update_one(
                    {"id": user_id},
                    {"$set": {"status": "active"}}
                )
            
            # Update transaction to confirmed
            await db.transactions.update_one(
                {"investment_id": investment_id},
                {
                    "$set": {
                        "type": "investment",
                        "description": f"Investment of ${amount} confirmed via crypto"
                    }
                }
            )
            
            # Process referral income (Direct Income) - ONLY if referrer is ACTIVE
            # Use plan's direct_income percentage or default to 5%
            plan_id = investment.get("plan", "premium")
            plan = await db.investment_plans.find_one({"id": plan_id})
            direct_income_percent = plan.get("direct_income", 5.0) if plan else 5.0
            
            if user.get("referred_by"):
                referrer = await db.users.find_one({"id": user["referred_by"]})
                
                if referrer and referrer.get("status") == "active":
                    referral_amount = amount * (direct_income_percent / 100)
                    await db.wallets.update_one(
                        {"user_id": user["referred_by"]},
                        {
                            "$inc": {
                                "direct_income": referral_amount,
                                "total_balance": referral_amount
                            }
                        }
                    )
                    
                    # Record referral income
                    referral_income = {
                        "id": str(uuid.uuid4()),
                        "user_id": user["referred_by"],
                        "referred_user_id": user_id,
                        "amount": referral_amount,
                        "percentage": direct_income_percent,
                        "date": datetime.utcnow()
                    }
                    await db.referral_income.insert_one(referral_income)
                    
                    # Create transaction for referrer
                    referrer_transaction = {
                        "id": str(uuid.uuid4()),
                        "user_id": user["referred_by"],
                        "type": "direct_income",
                        "amount": referral_amount,
                        "description": f"Direct referral income ({direct_income_percent}%) from {user['full_name']}",
                        "date": datetime.utcnow()
                    }
                    await db.transactions.insert_one(referrer_transaction)
                    
                    logging.info(f"Direct income: ${referral_amount:.2f} ({direct_income_percent}%) credited to {referrer['full_name']}")
            
            # NOTE: Level income is now distributed when team members earn Daily ROI,
            # not when investments are made. See distribute_level_income_from_roi() function.
            
            logging.info(f"Investment {investment_id} activated successfully")
        
        elif payment_status in ["waiting", "confirming", "confirmed", "sending"]:
            # Payment in progress - keep as pending
            await db.investments.update_one(
                {"id": investment_id},
                {"$set": {"payment_status": payment_status}}
            )
        
        elif payment_status in ["failed", "expired", "refunded"]:
            # Payment failed - mark investment as failed
            await db.investments.update_one(
                {"id": investment_id},
                {"$set": {"status": "payment_failed", "payment_status": payment_status}}
            )
            
            await db.transactions.update_one(
                {"investment_id": investment_id},
                {
                    "$set": {
                        "type": "investment_failed",
                        "description": f"Crypto investment failed - {payment_status}"
                    }
                }
            )
        
        elif payment_status == "partially_paid":
            # Partial payment received
            await db.investments.update_one(
                {"id": investment_id},
                {
                    "$set": {
                        "payment_status": "partially_paid",
                        "actually_paid": actually_paid
                    }
                }
            )
        
        return JSONResponse(status_code=200, content={"received": True, "payment_id": payment_id})
    
    except Exception as e:
        logging.error(f"Error processing webhook: {str(e)}")
        # Return 200 to prevent retries
        return JSONResponse(status_code=200, content={"received": True, "error": str(e)})


@api_router.get("/payment/estimate")
async def get_payment_estimate(amount: float, currency: str = "usdtbsc", current_user: dict = Depends(get_current_user)):
    """Get estimated payment amount including network fees from NOWPayments"""
    if amount < 20:
        raise HTTPException(status_code=400, detail="Minimum amount is $20")
    
    if not NOWPAYMENTS_API_KEY:
        # Return fallback estimate
        estimated_fee = (amount * 0.005) + 0.5
        return {
            "amount": amount,
            "currency": currency,
            "estimated_fee": estimated_fee,
            "total_amount": amount + estimated_fee,
            "source": "estimated"
        }
    
    try:
        async with httpx.AsyncClient() as client:
            # Get estimated price from NOWPayments
            response = await client.get(
                f"{NOWPAYMENTS_API_BASE_URL}/estimate",
                params={
                    "amount": amount,
                    "currency_from": "usd",
                    "currency_to": currency
                },
                headers={"x-api-key": NOWPAYMENTS_API_KEY}
            )
            
            if response.status_code == 200:
                data = response.json()
                estimated_amount = float(data.get("estimated_amount", amount))
                
                # Calculate the fee (difference between estimated and original)
                # USDT is typically 1:1 with USD, so any difference is fees
                estimated_fee = max(0, estimated_amount - amount)
                
                return {
                    "amount": amount,
                    "currency": currency,
                    "estimated_fee": estimated_fee,
                    "total_amount": estimated_amount,
                    "source": "nowpayments"
                }
            else:
                # Fallback estimate
                estimated_fee = (amount * 0.005) + 0.5
                return {
                    "amount": amount,
                    "currency": currency,
                    "estimated_fee": estimated_fee,
                    "total_amount": amount + estimated_fee,
                    "source": "estimated"
                }
                
    except Exception as e:
        logging.error(f"Error getting estimate: {str(e)}")
        # Fallback estimate
        estimated_fee = (amount * 0.005) + 0.5
        return {
            "amount": amount,
            "currency": currency,
            "estimated_fee": estimated_fee,
            "total_amount": amount + estimated_fee,
            "source": "estimated"
        }


@api_router.get("/payment/status/{investment_id}")
async def get_payment_status(investment_id: str, current_user: dict = Depends(get_current_user)):
    """Check payment status for an investment"""
    investment = await db.investments.find_one({
        "id": investment_id,
        "user_id": current_user["id"]
    })
    
    if not investment:
        raise HTTPException(status_code=404, detail="Investment not found")
    
    return {
        "investment_id": investment_id,
        "status": investment.get("status"),
        "payment_status": investment.get("payment_status"),
        "amount": investment.get("amount"),
        "cryptocurrency": investment.get("cryptocurrency"),
        "pay_address": investment.get("pay_address"),
        "pay_amount": investment.get("pay_amount"),
        "actually_paid": investment.get("actually_paid", 0)
    }


@api_router.get("/crypto/currencies")
async def get_available_cryptocurrencies():
    """Get list of supported cryptocurrencies from NOWPayments"""
    if not NOWPAYMENTS_API_KEY:
        # Return default list if API key not configured
        return {
            "currencies": ["btc", "eth", "usdttrc20", "usdcerc20", "bnbmainnet", "ltc", "xrp", "doge"]
        }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{NOWPAYMENTS_API_BASE_URL}/currencies",
                headers={"x-api-key": NOWPAYMENTS_API_KEY}
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                return {"currencies": ["btc", "eth", "usdttrc20", "usdcerc20", "bnbmainnet"]}
    
    except Exception as e:
        logging.error(f"Error fetching currencies: {str(e)}")
        return {"currencies": ["btc", "eth", "usdttrc20", "usdcerc20", "bnbmainnet"]}

def is_working_day(date_to_check=None):
    """
    Check if a given date is a working day.
    Non-working days: Saturday (5), Sunday (6), December 25th (Christmas)
    """
    if date_to_check is None:
        date_to_check = datetime.utcnow()
    
    # Check if weekend (Saturday=5, Sunday=6)
    if date_to_check.weekday() in [5, 6]:
        return False
    
    # Check if December 25th (Christmas)
    if date_to_check.month == 12 and date_to_check.day == 25:
        return False
    
    return True


def get_next_working_day(from_date=None):
    """Get the next working day from a given date"""
    if from_date is None:
        from_date = datetime.utcnow()
    
    next_day = from_date + timedelta(days=1)
    while not is_working_day(next_day):
        next_day += timedelta(days=1)
    
    return next_day


@api_router.post("/wallet/calculate-roi")
async def calculate_daily_roi(current_user: dict = Depends(get_current_user)):
    """Calculate and credit daily ROI based on investment plan (excludes weekends and Dec 25)"""
    
    # Check if today is a working day
    today = datetime.utcnow()
    if not is_working_day(today):
        day_name = today.strftime("%A")
        if today.month == 12 and today.day == 25:
            return {"message": "ROI not credited on Christmas Day (December 25)", "roi": 0, "is_holiday": True}
        return {"message": f"ROI not credited on {day_name} (non-working day)", "roi": 0, "is_holiday": True}
    
    wallet = await db.wallets.find_one({"user_id": current_user["id"]})
    
    if not wallet or wallet.get("total_invested", 0) <= 0:
        return {"message": "No active investment", "roi": 0}
    
    # Check if ROI already calculated today
    if wallet.get("last_roi_date"):
        last_date = wallet["last_roi_date"].date()
        if last_date == today.date():
            return {"message": "ROI already calculated today", "roi": 0}
    
    # Get user's active investments to calculate ROI based on plan
    active_investments = await db.investments.find({
        "user_id": current_user["id"],
        "status": "active"
    }).to_list(100)
    
    if not active_investments:
        return {"message": "No active investments", "roi": 0}
    
    total_roi = 0
    roi_details = []
    
    for investment in active_investments:
        # Get the plan for this investment
        plan_id = investment.get("plan", "premium")
        plan = await db.investment_plans.find_one({"id": plan_id})
        
        # Use plan's daily_roi or default to 1%
        daily_roi_percent = plan.get("daily_roi", 1.0) if plan else 1.0
        
        # Calculate ROI for this investment
        investment_amount = investment.get("amount", 0)
        roi_amount = investment_amount * (daily_roi_percent / 100)
        total_roi += roi_amount
        
        roi_details.append({
            "investment_id": investment.get("id"),
            "amount": investment_amount,
            "roi_percent": daily_roi_percent,
            "roi_amount": roi_amount
        })
    
    if total_roi <= 0:
        return {"message": "No ROI to credit", "roi": 0}
    
    # Update wallet
    await db.wallets.update_one(
        {"user_id": current_user["id"]},
        {
            "$inc": {
                "daily_roi": total_roi,
                "total_balance": total_roi
            },
            "$set": {"last_roi_date": datetime.utcnow()}
        }
    )
    
    # Create transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "type": "daily_roi",
        "amount": total_roi,
        "description": f"Daily ROI - {today.strftime('%Y-%m-%d')}",
        "date": datetime.utcnow(),
        "details": roi_details
    }
    await db.transactions.insert_one(transaction)
    
    # Distribute level income to upline users based on this user's ROI
    # Uplines receive a percentage of this ROI based on their own investment slab
    level_distributions = await distribute_level_income_from_roi(
        current_user["id"], 
        total_roi, 
        current_user.get("full_name", "User")
    )
    
    return {
        "message": "ROI calculated successfully",
        "roi": total_roi,
        "date": today.strftime("%Y-%m-%d"),
        "is_working_day": True,
        "details": roi_details,
        "level_income_distributed": len(level_distributions)
    }


@api_router.get("/working-days/status")
async def get_working_day_status():
    """Check if today is a working day and get upcoming working/non-working days"""
    today = datetime.utcnow()
    
    # Get next 7 days status
    upcoming_days = []
    for i in range(7):
        check_date = today + timedelta(days=i)
        day_info = {
            "date": check_date.strftime("%Y-%m-%d"),
            "day_name": check_date.strftime("%A"),
            "is_working_day": is_working_day(check_date),
            "reason": None
        }
        
        if not day_info["is_working_day"]:
            if check_date.weekday() == 5:
                day_info["reason"] = "Saturday"
            elif check_date.weekday() == 6:
                day_info["reason"] = "Sunday"
            elif check_date.month == 12 and check_date.day == 25:
                day_info["reason"] = "Christmas Day"
        
        upcoming_days.append(day_info)
    
    return {
        "today": today.strftime("%Y-%m-%d"),
        "today_name": today.strftime("%A"),
        "is_today_working_day": is_working_day(today),
        "non_working_days": ["Saturday", "Sunday", "December 25 (Christmas)"],
        "upcoming_days": upcoming_days
    }

# ==================== TRANSACTION ROUTES ====================

@api_router.get("/transactions", response_model=List[Transaction])
async def get_transactions(current_user: dict = Depends(get_current_user)):
    transactions = await db.transactions.find(
        {"user_id": current_user["id"]}
    ).sort("date", -1).limit(50).to_list(50)
    return transactions


@api_router.get("/investments/active")
async def get_active_investments(current_user: dict = Depends(get_current_user)):
    """Get user's active investments with progress info"""
    investments = await db.investments.find(
        {"user_id": current_user["id"], "status": "active"}
    ).sort("date", -1).to_list(100)
    
    now = datetime.utcnow()
    result = []
    
    # Cache plans for performance
    plans_cache = {}
    
    for inv in investments:
        start_date = inv.get("date", now)
        validity_days = inv.get("validity_days", 100)
        end_date = inv.get("end_date", start_date + timedelta(days=validity_days))
        
        # Calculate days elapsed and remaining
        days_elapsed = (now - start_date).days
        days_remaining = max(0, (end_date - now).days)
        progress_percent = min(100, (days_elapsed / validity_days) * 100) if validity_days > 0 else 100
        
        # Check if investment has completed
        if now >= end_date:
            # Mark as completed if end date has passed
            await db.investments.update_one(
                {"id": inv["id"]},
                {"$set": {"status": "completed"}}
            )
            continue
        
        # Get plan name
        plan_id = inv.get("plan", "premium")
        if plan_id not in plans_cache:
            plan_doc = await db.investment_plans.find_one({"id": plan_id})
            plans_cache[plan_id] = plan_doc.get("name", plan_id) if plan_doc else plan_id
        plan_name = plans_cache[plan_id]
        
        result.append({
            "id": inv["id"],
            "amount": inv["amount"],
            "plan": plan_name,  # Now returns plan NAME instead of ID
            "plan_id": plan_id,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "validity_days": validity_days,
            "days_elapsed": days_elapsed,
            "days_remaining": days_remaining,
            "progress_percent": round(progress_percent, 1),
            "status": inv["status"]
        })
    
    return result


# ==================== TEAM/REFERRAL ROUTES ====================

@api_router.get("/team/members")
async def get_team_members(current_user: dict = Depends(get_current_user)):
    # Get direct referrals
    referrals = await db.users.find({"referred_by": current_user["id"]}).to_list(100)
    
    team_members = []
    for referral in referrals:
        wallet = await db.wallets.find_one({"user_id": referral["id"]})
        team_members.append({
            "user_id": referral["id"],
            "user_number": referral.get("user_number", "N/A"),
            "full_name": referral["full_name"],
            "email": referral["email"],
            "joined_date": referral["created_at"].isoformat() if hasattr(referral["created_at"], 'isoformat') else str(referral["created_at"]),
            "total_investment": wallet.get("total_invested", 0) if wallet else 0,
            "level": 1
        })
    
    # Return wrapped response with totals
    return {
        "total_team": len(team_members),
        "direct_referrals": len(team_members),
        "members": team_members
    }

@api_router.get("/team/income")
async def get_team_income(current_user: dict = Depends(get_current_user)):
    # Get referral income
    referral_incomes = await db.referral_income.find(
        {"user_id": current_user["id"]}
    ).to_list(100)
    
    total_direct_income = sum([income["amount"] for income in referral_incomes])
    
    # Clean referral history to remove MongoDB ObjectId
    clean_history = []
    for income in referral_incomes:
        clean_history.append({
            "id": income["id"],
            "user_id": income["user_id"],
            "referred_user_id": income["referred_user_id"],
            "amount": income["amount"],
            "date": income["date"]
        })
    
    return {
        "total_direct_income": total_direct_income,
        "total_referrals": len(referral_incomes),
        "referral_history": clean_history
    }

# ==================== DASHBOARD ROUTES ====================

@api_router.get("/dashboard/stats", response_model=DashboardStats)
async def get_dashboard_stats(current_user: dict = Depends(get_current_user)):
    wallet = await db.wallets.find_one({"user_id": current_user["id"]})
    
    # Calculate total balance
    total_net_worth = wallet.get("total_balance", 0)
    
    # Calculate daily ROI potential based on active investments and their plans
    daily_roi = 0
    active_investments = await db.investments.find({
        "user_id": current_user["id"],
        "status": "active"
    }).to_list(100)
    
    for investment in active_investments:
        plan_id = investment.get("plan", "premium")
        plan = await db.investment_plans.find_one({"id": plan_id})
        roi_percent = plan.get("daily_roi", 1.0) if plan else 1.0
        daily_roi += investment.get("amount", 0) * (roi_percent / 100)
    
    # Get team stats
    referrals = await db.users.find({"referred_by": current_user["id"]}).to_list(100)
    total_referrals = len(referrals)
    
    # Get referral income
    direct_income = wallet.get("direct_income", 0)
    level_income = wallet.get("slab_income", 0) + wallet.get("royalty_income", 0) + wallet.get("salary_income", 0)
    
    return {
        "total_net_worth": total_net_worth,
        "daily_roi": daily_roi,
        "total_referrals": total_referrals,
        "total_team_members": total_referrals,
        "direct_income": direct_income,
        "level_income": level_income
    }

@api_router.get("/dashboard/chart-data")
async def get_chart_data(current_user: dict = Depends(get_current_user)):
    # Get last 30 days of transactions
    thirty_days_ago = datetime.utcnow() - timedelta(days=30)
    transactions = await db.transactions.find({
        "user_id": current_user["id"],
        "date": {"$gte": thirty_days_ago}
    }).sort("date", 1).to_list(1000)
    
    # Calculate cumulative balance
    chart_data = []
    cumulative = 0
    
    for transaction in transactions:
        if transaction["type"] in ["investment", "roi", "direct_income", "slab_income", "royalty_income"]:
            cumulative += transaction["amount"]
        elif transaction["type"] == "withdrawal":
            cumulative -= transaction["amount"]
        
        chart_data.append({
            "date": transaction["date"].strftime("%Y-%m-%d"),
            "value": cumulative
        })
    
    return {"chart_data": chart_data}

# ==================== SUPPORT TICKET ROUTES ====================

@api_router.post("/tickets")
async def create_ticket(ticket: TicketCreate, current_user: dict = Depends(get_current_user)):
    """Create a new support ticket"""
    ticket_id = str(uuid.uuid4())
    ticket_number = f"TKT{random.randint(100000, 999999)}"
    
    ticket_doc = {
        "id": ticket_id,
        "ticket_number": ticket_number,
        "user_id": current_user["id"],
        "user_email": current_user["email"],
        "user_name": current_user.get("full_name", "User"),
        "user_number": current_user.get("user_number", "N/A"),
        "subject": ticket.subject,
        "category": ticket.category,
        "priority": ticket.priority,
        "status": "open",
        "messages": [
            {
                "id": str(uuid.uuid4()),
                "sender": "user",
                "sender_name": current_user.get("full_name", "User"),
                "message": ticket.message,
                "timestamp": datetime.utcnow()
            }
        ],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    await db.tickets.insert_one(ticket_doc)
    
    return {
        "success": True,
        "message": "Ticket created successfully",
        "ticket_number": ticket_number,
        "ticket_id": ticket_id
    }

@api_router.get("/tickets")
async def get_user_tickets(current_user: dict = Depends(get_current_user)):
    """Get all tickets for the current user"""
    tickets = await db.tickets.find(
        {"user_id": current_user["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return {"tickets": tickets}

@api_router.get("/tickets/{ticket_id}")
async def get_ticket_details(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Get details of a specific ticket"""
    ticket = await db.tickets.find_one(
        {"id": ticket_id, "user_id": current_user["id"]},
        {"_id": 0}
    )
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    return ticket

@api_router.post("/tickets/{ticket_id}/reply")
async def reply_to_ticket(ticket_id: str, reply: TicketReply, current_user: dict = Depends(get_current_user)):
    """Add a reply to an existing ticket (user)"""
    ticket = await db.tickets.find_one({"id": ticket_id, "user_id": current_user["id"]})
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    if ticket["status"] == "closed":
        raise HTTPException(status_code=400, detail="Cannot reply to a closed ticket")
    
    new_message = {
        "id": str(uuid.uuid4()),
        "sender": "user",
        "sender_name": current_user.get("full_name", "User"),
        "message": reply.message,
        "timestamp": datetime.utcnow()
    }
    
    await db.tickets.update_one(
        {"id": ticket_id},
        {
            "$push": {"messages": new_message},
            "$set": {"updated_at": datetime.utcnow(), "status": "open"}
        }
    )
    
    return {"success": True, "message": "Reply added successfully"}

# ==================== ADMIN ROUTES ====================

# Admin user check
async def get_admin_user(current_user: dict = Depends(get_current_user)):
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

@api_router.post("/admin/create")
async def create_admin():
    """Create initial admin user - should only be called once"""
    # Check if admin already exists
    existing_admin = await db.users.find_one({"is_admin": True})
    if existing_admin:
        raise HTTPException(status_code=400, detail="Admin already exists")
    
    admin_id = str(uuid.uuid4())
    hashed_password = get_password_hash("admin123")  # Change this password immediately
    referral_code = generate_referral_code()
    
    admin = {
        "id": admin_id,
        "email": "admin@ssmoneyresource.com",
        "password": hashed_password,
        "full_name": "Admin User",
        "referral_code": referral_code,
        "referred_by": None,
        "created_at": datetime.utcnow(),
        "is_admin": True
    }
    
    await db.users.insert_one(admin)
    
    # Create wallet for admin
    wallet = {
        "user_id": admin_id,
        "investment_balance": 0.0,
        "earning_balance": 0.0,
        "withdrawal_balance": 0.0,
        "total_invested": 0.0,
        "total_earned": 0.0,
        "last_roi_date": None
    }
    await db.wallets.insert_one(wallet)
    
    return {"message": "Admin created successfully", "email": "admin@ssmoneyresource.com", "password": "admin123"}

@api_router.get("/admin/dashboard/stats")
async def get_admin_dashboard_stats(admin_user: dict = Depends(get_admin_user)):
    """Get platform-wide statistics"""
    total_users = await db.users.count_documents({})
    total_investments = await db.investments.count_documents({})
    
    # Calculate total platform investment
    pipeline = [
        {"$group": {"_id": None, "total": {"$sum": "$total_invested"}}}
    ]
    investment_result = await db.wallets.aggregate(pipeline).to_list(1)
    total_platform_investment = investment_result[0]["total"] if investment_result else 0
    
    # Calculate total earnings distributed
    earnings_pipeline = [
        {"$group": {"_id": None, "total": {"$sum": "$total_earned"}}}
    ]
    earnings_result = await db.wallets.aggregate(earnings_pipeline).to_list(1)
    total_earnings = earnings_result[0]["total"] if earnings_result else 0
    
    # Get today's transactions count
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_transactions = await db.transactions.count_documents({"date": {"$gte": today_start}})
    
    # Calculate income summary by type
    income_summary_pipeline = [
        {"$group": {
            "_id": None,
            "daily_roi": {"$sum": "$daily_roi"},
            "direct_income": {"$sum": "$direct_income"},
            "slab_income": {"$sum": "$slab_income"},
            "royalty_income": {"$sum": "$royalty_income"},
            "salary_income": {"$sum": "$salary_income"}
        }}
    ]
    income_result = await db.wallets.aggregate(income_summary_pipeline).to_list(1)
    income_summary = {
        "daily_roi": income_result[0].get("daily_roi", 0) if income_result else 0,
        "direct_income": income_result[0].get("direct_income", 0) if income_result else 0,
        "slab_income": income_result[0].get("slab_income", 0) if income_result else 0,
        "royalty_income": income_result[0].get("royalty_income", 0) if income_result else 0,
        "salary_income": income_result[0].get("salary_income", 0) if income_result else 0
    }
    
    # Get pending withdrawals count (when implemented)
    pending_withdrawals = 0
    
    return {
        "total_users": total_users,
        "total_investments": total_investments,
        "total_platform_investment": total_platform_investment,
        "total_earnings_distributed": total_earnings,
        "today_transactions": today_transactions,
        "pending_withdrawals": pending_withdrawals,
        "income_summary": income_summary
    }

@api_router.get("/admin/users")
async def get_all_users(
    skip: int = 0,
    limit: int = 50,
    admin_user: dict = Depends(get_admin_user)
):
    """Get all users with pagination"""
    users = await db.users.find().skip(skip).limit(limit).to_list(limit)
    
    # Get wallet info for each user
    users_with_wallets = []
    for user in users:
        wallet = await db.wallets.find_one({"user_id": user["id"]})
        wallet_data = None
        if wallet:
            wallet_data = {
                "investment_balance": wallet.get("investment_balance", 0),
                "earning_balance": wallet.get("earning_balance", 0),
                "withdrawal_balance": wallet.get("withdrawal_balance", 0),
                "total_invested": wallet.get("total_invested", 0),
                "total_earned": wallet.get("total_earned", 0),
                "total_withdrawn": wallet.get("total_withdrawn", 0),
                "daily_roi": wallet.get("daily_roi", 0),
                "direct_income": wallet.get("direct_income", 0),
                "slab_income": wallet.get("slab_income", 0),
                "royalty_income": wallet.get("royalty_income", 0),
                "salary_income": wallet.get("salary_income", 0)
            }
        
        users_with_wallets.append({
            "id": user["id"],
            "user_number": user.get("user_number", "N/A"),
            "email": user["email"],
            "full_name": user["full_name"],
            "referral_code": user["referral_code"],
            "status": user.get("status", "active"),
            "created_at": user["created_at"].isoformat() if hasattr(user["created_at"], 'isoformat') else str(user["created_at"]),
            "is_admin": user.get("is_admin", False),
            "wallet": wallet_data
        })
    
    total_count = await db.users.count_documents({})
    
    return {
        "users": users_with_wallets,
        "total": total_count,
        "skip": skip,
        "limit": limit
    }

class AdminCreateUser(BaseModel):
    email: str
    password: str
    full_name: str
    status: str = "active"  # Admin can set active or inactive
    referral_code: Optional[str] = None  # Optional: assign to a referrer

@api_router.post("/admin/users/create")
async def admin_create_user(user_data: AdminCreateUser, admin_user: dict = Depends(get_admin_user)):
    """Admin can create a user directly with active status"""
    # Check if user exists
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Validate referral code if provided
    referrer = None
    if user_data.referral_code:
        clean_code = user_data.referral_code.lstrip('#').strip()
        
        # Try to find by user_number (format: 01SSMR, 02SSMR, etc.)
        if clean_code.upper().endswith('SSMR'):
            referrer = await db.users.find_one({"user_number": clean_code.upper()})
        
        if not referrer:
            referrer = await db.users.find_one({"referral_code": clean_code.upper()})
        if not referrer:
            referrer = await db.users.find_one({"referral_code": clean_code})
    
    # Generate unique user number in format: 01SSMR, 02SSMR, etc.
    last_user = await db.users.find_one(sort=[("user_seq", -1)])
    user_seq = (last_user.get("user_seq", 0) + 1) if last_user else 1
    user_number = f"{user_seq:02d}SSMR"  # Format: 01SSMR, 02SSMR, etc.
    
    # Create user
    user_id = str(uuid.uuid4())
    hashed_password = get_password_hash(user_data.password)
    referral_code = generate_referral_code()
    
    user = {
        "id": user_id,
        "user_seq": user_seq,  # Sequential number for generating user_number
        "user_number": user_number,  # Display format: 01SSMR, 02SSMR, etc.
        "email": user_data.email,
        "password": hashed_password,
        "full_name": user_data.full_name,
        "referral_code": referral_code,
        "referred_by": referrer["id"] if referrer else None,
        "status": user_data.status,  # Admin can set status directly
        "created_at": datetime.utcnow(),
        "created_by_admin": True,  # Track that this user was created by admin
        "created_by_admin_id": admin_user["id"],
        "created_by_admin_email": admin_user["email"]
    }
    
    await db.users.insert_one(user)
    
    # Create wallet for user
    wallet = {
        "user_id": user_id,
        "daily_roi": 0.0,
        "direct_income": 0.0,
        "slab_income": 0.0,
        "royalty_income": 0.0,
        "salary_income": 0.0,
        "withdrawal_balance": 0.0,
        "total_balance": 0.0,
        "total_invested": 0.0,
        "total_withdrawn": 0.0,
        "last_roi_date": None
    }
    await db.wallets.insert_one(wallet)
    
    return {
        "message": "User created successfully",
        "user": {
            "id": user_id,
            "user_number": user_number,
            "email": user_data.email,
            "full_name": user_data.full_name,
            "referral_code": referral_code,
            "status": user_data.status
        }
    }

@api_router.get("/admin/users/created-by-admin")
async def get_admin_created_users(admin_user: dict = Depends(get_admin_user)):
    """Get history of all users created by admin"""
    users = await db.users.find({"created_by_admin": True}).sort("created_at", -1).to_list(500)
    
    users_list = []
    for user in users:
        wallet = await db.wallets.find_one({"user_id": user["id"]})
        
        users_list.append({
            "id": user["id"],
            "user_number": user.get("user_number"),
            "email": user["email"],
            "full_name": user["full_name"],
            "referral_code": user.get("referral_code"),
            "status": user.get("status", "active"),
            "total_invested": wallet.get("total_invested", 0) if wallet else 0,
            "created_at": user["created_at"].isoformat() if hasattr(user["created_at"], 'isoformat') else str(user["created_at"]),
            "created_by_admin_email": user.get("created_by_admin_email", "Unknown")
        })
    
    return {
        "total": len(users_list),
        "users": users_list
    }

class UpdateUserEmail(BaseModel):
    email: str

@api_router.put("/admin/users/{user_id}/email")
async def update_user_email(user_id: str, data: UpdateUserEmail, admin_user: dict = Depends(get_admin_user)):
    """Admin can update user email"""
    # Check if user exists
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if new email is already in use by another user
    existing = await db.users.find_one({"email": data.email, "id": {"$ne": user_id}})
    if existing:
        raise HTTPException(status_code=400, detail="Email already in use by another user")
    
    # Update email
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"email": data.email}}
    )
    
    return {"message": "Email updated successfully", "email": data.email}

class ChangeReferrer(BaseModel):
    new_referrer_code: str

@api_router.put("/admin/users/{user_id}/referrer")
async def change_user_referrer(user_id: str, data: ChangeReferrer, admin_user: dict = Depends(get_admin_user)):
    """Admin can change user's referrer. Referral bonuses will be shifted to new referrer."""
    # Check if user exists
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    old_referrer_id = user.get("referred_by")
    
    # Find new referrer by user number or referral code
    new_referrer = None
    clean_code = data.new_referrer_code.lstrip('#')
    
    try:
        user_number = int(clean_code)
        new_referrer = await db.users.find_one({"user_number": user_number})
    except ValueError:
        pass
    
    if not new_referrer:
        new_referrer = await db.users.find_one({"referral_code": clean_code.upper()})
    if not new_referrer:
        new_referrer = await db.users.find_one({"referral_code": clean_code})
    
    if not new_referrer:
        raise HTTPException(status_code=404, detail="New referrer not found")
    
    # Cannot refer to self
    if new_referrer["id"] == user_id:
        raise HTTPException(status_code=400, detail="User cannot be their own referrer")
    
    # Check if new referrer is same as old
    if new_referrer["id"] == old_referrer_id:
        raise HTTPException(status_code=400, detail="This is already the current referrer")
    
    # Calculate total direct income earned from this user by old referrer
    referral_incomes = await db.referral_income.find({
        "user_id": old_referrer_id,
        "referred_user_id": user_id
    }).to_list(100)
    
    total_bonus_to_shift = sum([income["amount"] for income in referral_incomes])
    
    # Shift the bonus: Deduct from old referrer, add to new referrer
    if total_bonus_to_shift > 0 and old_referrer_id:
        # Deduct from old referrer
        await db.wallets.update_one(
            {"user_id": old_referrer_id},
            {"$inc": {"direct_income": -total_bonus_to_shift, "total_balance": -total_bonus_to_shift}}
        )
        
        # Add to new referrer
        await db.wallets.update_one(
            {"user_id": new_referrer["id"]},
            {"$inc": {"direct_income": total_bonus_to_shift, "total_balance": total_bonus_to_shift}}
        )
        
        # Update referral_income records
        await db.referral_income.update_many(
            {"user_id": old_referrer_id, "referred_user_id": user_id},
            {"$set": {"user_id": new_referrer["id"]}}
        )
        
        # Update transaction records (for audit trail, create new transactions)
        if old_referrer_id:
            # Debit transaction for old referrer
            await db.transactions.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": old_referrer_id,
                "type": "referral_transfer_out",
                "amount": -total_bonus_to_shift,
                "description": f"Referral bonus transferred out for {user['full_name']} (referrer changed by admin)",
                "date": datetime.utcnow()
            })
        
        # Credit transaction for new referrer
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": new_referrer["id"],
            "type": "referral_transfer_in",
            "amount": total_bonus_to_shift,
            "description": f"Referral bonus transferred in for {user['full_name']} (referrer changed by admin)",
            "date": datetime.utcnow()
        })
    
    # Update user's referred_by field
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"referred_by": new_referrer["id"]}}
    )
    
    return {
        "message": "Referrer changed successfully",
        "old_referrer": old_referrer_id,
        "new_referrer": {
            "id": new_referrer["id"],
            "user_number": new_referrer.get("user_number"),
            "full_name": new_referrer["full_name"]
        },
        "bonus_shifted": total_bonus_to_shift
    }

@api_router.get("/admin/lookup-user/{code}")
async def admin_lookup_user(code: str, admin_user: dict = Depends(get_admin_user)):
    """Lookup a user by user number or referral code"""
    clean_code = code.lstrip('#')
    user = None
    
    try:
        user_number = int(clean_code)
        user = await db.users.find_one({"user_number": user_number})
    except ValueError:
        pass
    
    if not user:
        user = await db.users.find_one({"referral_code": clean_code.upper()})
    if not user:
        user = await db.users.find_one({"referral_code": clean_code})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "id": user["id"],
        "user_number": user.get("user_number"),
        "full_name": user["full_name"],
        "email": user["email"],
        "status": user.get("status", "active")
    }

class BulkUserAction(BaseModel):
    user_ids: List[str]

@api_router.post("/admin/users/bulk-deactivate")
async def bulk_deactivate_users(data: BulkUserAction, admin_user: dict = Depends(get_admin_user)):
    """Deactivate multiple users at once"""
    if not data.user_ids:
        raise HTTPException(status_code=400, detail="No users selected")
    
    result = await db.users.update_many(
        {"id": {"$in": data.user_ids}},
        {"$set": {"status": "inactive"}}
    )
    
    return {"message": f"Successfully deactivated {result.modified_count} users"}

@api_router.post("/admin/users/bulk-delete")
async def bulk_delete_users(data: BulkUserAction, admin_user: dict = Depends(get_admin_user)):
    """Delete multiple users at once"""
    if not data.user_ids:
        raise HTTPException(status_code=400, detail="No users selected")
    
    # Delete users
    user_result = await db.users.delete_many({"id": {"$in": data.user_ids}})
    
    # Also delete their wallets
    await db.wallets.delete_many({"user_id": {"$in": data.user_ids}})
    
    # Delete their transactions
    await db.transactions.delete_many({"user_id": {"$in": data.user_ids}})
    
    # Delete their investments
    await db.investments.delete_many({"user_id": {"$in": data.user_ids}})
    
    return {"message": f"Successfully deleted {user_result.deleted_count} users"}

@api_router.put("/admin/users/{user_id}/deactivate")
async def deactivate_user(user_id: str, admin_user: dict = Depends(get_admin_user)):
    """Deactivate a single user"""
    result = await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": "inactive"}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": "User deactivated successfully"}

@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, admin_user: dict = Depends(get_admin_user)):
    """Delete a single user"""
    # Delete user
    result = await db.users.delete_one({"id": user_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Also delete wallet
    await db.wallets.delete_one({"user_id": user_id})
    
    # Delete transactions
    await db.transactions.delete_many({"user_id": user_id})
    
    # Delete investments
    await db.investments.delete_many({"user_id": user_id})
    
    return {"message": "User deleted successfully"}

@api_router.get("/admin/users/{user_id}")
async def get_user_details(user_id: str, admin_user: dict = Depends(get_admin_user)):
    """Get detailed user information"""
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    wallet = await db.wallets.find_one({"user_id": user_id})
    referrals = await db.users.find({"referred_by": user_id}).to_list(100)
    
    # Serialize user
    user_data = {
        "id": user["id"],
        "email": user["email"],
        "full_name": user["full_name"],
        "referral_code": user["referral_code"],
        "referred_by": user.get("referred_by"),
        "created_at": user["created_at"].isoformat() if hasattr(user["created_at"], 'isoformat') else str(user["created_at"]),
        "is_admin": user.get("is_admin", False)
    }
    
    # Serialize wallet
    wallet_data = None
    if wallet:
        wallet_data = {
            "investment_balance": wallet.get("investment_balance", 0),
            "earning_balance": wallet.get("earning_balance", 0),
            "withdrawal_balance": wallet.get("withdrawal_balance", 0),
            "total_invested": wallet.get("total_invested", 0),
            "total_earned": wallet.get("total_earned", 0),
            "daily_roi": wallet.get("daily_roi", 0),
            "direct_income": wallet.get("direct_income", 0),
            "slab_income": wallet.get("slab_income", 0),
            "royalty_income": wallet.get("royalty_income", 0),
            "salary_income": wallet.get("salary_income", 0)
        }
    
    return {
        "user": user_data,
        "wallet": wallet_data,
        "referrals": [{"id": r["id"], "full_name": r["full_name"], "email": r["email"]} for r in referrals]
    }

@api_router.get("/admin/users/{user_id}/transactions")
async def get_user_transactions(user_id: str, admin_user: dict = Depends(get_admin_user)):
    """Get complete transaction history for a specific user"""
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get all transactions
    transactions = await db.transactions.find({"user_id": user_id}).sort("date", -1).to_list(500)
    
    # Get all investments
    investments = await db.investments.find({"user_id": user_id}).sort("date", -1).to_list(100)
    
    # Get all withdrawals
    withdrawals = await db.withdrawals.find({"user_id": user_id}).sort("request_timestamp", -1).to_list(100)
    
    # Get plan names for investments
    plans_cache = {}
    investments_with_names = []
    for i in investments:
        plan_id = i.get("plan", "premium")
        if plan_id not in plans_cache:
            plan_doc = await db.investment_plans.find_one({"id": plan_id})
            plans_cache[plan_id] = plan_doc.get("name", plan_id) if plan_doc else plan_id
        
        investments_with_names.append({
            "id": i.get("id"),
            "amount": i.get("amount"),
            "plan": plans_cache[plan_id],  # Plan NAME instead of ID
            "plan_id": plan_id,
            "status": i.get("status"),
            "validity_days": i.get("validity_days", 100),
            "start_date": i.get("date").isoformat() if hasattr(i.get("date"), 'isoformat') else str(i.get("date", "")),
            "end_date": i.get("end_date").isoformat() if hasattr(i.get("end_date"), 'isoformat') else str(i.get("end_date", ""))
        })
    
    return {
        "user_id": user_id,
        "user_name": user["full_name"],
        "transactions": [
            {
                "id": t.get("id"),
                "type": t.get("type"),
                "amount": t.get("amount"),
                "description": t.get("description", ""),
                "date": t.get("date").isoformat() if hasattr(t.get("date"), 'isoformat') else str(t.get("date", ""))
            } for t in transactions
        ],
        "investments": investments_with_names,
        "withdrawals": [
            {
                "id": w.get("id"),
                "amount": w.get("amount"),
                "status": w.get("status"),
                "request_date": w.get("request_timestamp").isoformat() if hasattr(w.get("request_timestamp"), 'isoformat') else str(w.get("request_timestamp", "")),
                "processed_date": w.get("processed_timestamp").isoformat() if w.get("processed_timestamp") and hasattr(w.get("processed_timestamp"), 'isoformat') else ""
            } for w in withdrawals
        ],
        "summary": {
            "total_transactions": len(transactions),
            "total_investments": len(investments),
            "total_withdrawals": len(withdrawals),
            "total_invested_amount": sum(i.get("amount", 0) for i in investments),
            "total_withdrawn_amount": sum(w.get("amount", 0) for w in withdrawals if w.get("status") == "approved")
        }
    }

@api_router.get("/admin/users/{user_id}/referrals")
async def get_user_referrals(user_id: str, admin_user: dict = Depends(get_admin_user)):
    """Get detailed referral information for a specific user"""
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get direct referrals (level 1)
    direct_referrals = await db.users.find({"referred_by": user_id}).to_list(100)
    
    referrals_data = []
    total_team_investment = 0
    
    for ref in direct_referrals:
        # Get wallet for each referral
        ref_wallet = await db.wallets.find_one({"user_id": ref["id"]})
        ref_invested = ref_wallet.get("total_invested", 0) if ref_wallet else 0
        total_team_investment += ref_invested
        
        # Get their direct referrals count (level 2)
        level2_count = await db.users.count_documents({"referred_by": ref["id"]})
        
        referrals_data.append({
            "id": ref["id"],
            "user_number": ref.get("user_number"),
            "full_name": ref["full_name"],
            "email": ref["email"],
            "status": ref.get("status", "active"),
            "total_invested": ref_invested,
            "joined_date": ref["created_at"].isoformat() if hasattr(ref["created_at"], 'isoformat') else str(ref["created_at"]),
            "referral_code": ref.get("referral_code"),
            "level2_referrals": level2_count
        })
    
    # Get who referred this user
    referred_by_user = None
    if user.get("referred_by"):
        referrer = await db.users.find_one({"id": user["referred_by"]})
        if referrer:
            referred_by_user = {
                "id": referrer["id"],
                "user_number": referrer.get("user_number"),
                "full_name": referrer["full_name"],
                "email": referrer["email"]
            }
    
    return {
        "user_id": user_id,
        "user_name": user["full_name"],
        "referral_code": user.get("referral_code"),
        "referred_by": referred_by_user,
        "direct_referrals": referrals_data,
        "summary": {
            "total_direct_referrals": len(referrals_data),
            "total_team_investment": total_team_investment,
            "active_referrals": len([r for r in referrals_data if r["status"] == "active"]),
            "inactive_referrals": len([r for r in referrals_data if r["status"] != "active"])
        }
    }

@api_router.post("/admin/users/{user_id}/credit")
async def credit_user_wallet(
    user_id: str,
    amount: float,
    wallet_type: str,  # investment, earning, withdrawal
    description: str,
    admin_user: dict = Depends(get_admin_user)
):
    """Manually credit user wallet"""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    if wallet_type not in ["investment", "earning", "withdrawal"]:
        raise HTTPException(status_code=400, detail="Invalid wallet type")
    
    wallet_field = f"{wallet_type}_balance"
    
    # Update wallet
    await db.wallets.update_one(
        {"user_id": user_id},
        {"$inc": {wallet_field: amount}}
    )
    
    # Create transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": "admin_credit",
        "amount": amount,
        "description": f"Admin credit: {description}",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(transaction)
    
    return {"message": "Wallet credited successfully", "amount": amount, "wallet": wallet_type}

@api_router.post("/admin/users/{user_id}/debit")
async def debit_user_wallet(
    user_id: str,
    amount: float,
    wallet_type: str,
    description: str,
    admin_user: dict = Depends(get_admin_user)
):
    """Manually debit user wallet"""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    if wallet_type not in ["investment", "earning", "withdrawal"]:
        raise HTTPException(status_code=400, detail="Invalid wallet type")
    
    wallet_field = f"{wallet_type}_balance"
    
    # Check if user has sufficient balance
    wallet = await db.wallets.find_one({"user_id": user_id})
    if wallet[wallet_field] < amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    # Update wallet
    await db.wallets.update_one(
        {"user_id": user_id},
        {"$inc": {wallet_field: -amount}}
    )
    
    # Create transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": "admin_debit",
        "amount": amount,
        "description": f"Admin debit: {description}",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(transaction)
    
    return {"message": "Wallet debited successfully", "amount": amount, "wallet": wallet_type}

@api_router.get("/admin/transactions")
async def get_all_transactions(
    skip: int = 0,
    limit: int = 100,
    admin_user: dict = Depends(get_admin_user)
):
    """Get all platform transactions"""
    transactions = await db.transactions.find().sort("date", -1).skip(skip).limit(limit).to_list(limit)
    total_count = await db.transactions.count_documents({})
    
    # Enrich with user info and serialize
    result = []
    for transaction in transactions:
        user = await db.users.find_one({"id": transaction["user_id"]})
        result.append({
            "id": transaction.get("id", str(transaction.get("_id", ""))),
            "user_id": transaction["user_id"],
            "user_email": user["email"] if user else "N/A",
            "user_name": user["full_name"] if user else "Unknown",
            "type": transaction.get("type", "unknown"),
            "amount": transaction.get("amount", 0),
            "description": transaction.get("description", ""),
            "date": transaction.get("date", datetime.utcnow()).isoformat()
        })
    
    return {
        "transactions": result,
        "total": total_count,
        "skip": skip,
        "limit": limit
    }

@api_router.get("/admin/investments")
async def get_all_investments(
    skip: int = 0,
    limit: int = 100,
    admin_user: dict = Depends(get_admin_user)
):
    """Get all investments"""
    investments = await db.investments.find().sort("date", -1).skip(skip).limit(limit).to_list(limit)
    total_count = await db.investments.count_documents({})
    
    # Enrich with user info and serialize
    result = []
    for investment in investments:
        user = await db.users.find_one({"id": investment["user_id"]})
        result.append({
            "id": investment.get("id", str(investment.get("_id", ""))),
            "user_id": investment["user_id"],
            "user_email": user["email"] if user else "N/A",
            "user_name": user["full_name"] if user else "Unknown",
            "amount": investment.get("amount", 0),
            "date": investment.get("date", datetime.utcnow()).isoformat(),
            "status": investment.get("status", "active")
        })
    
    return {
        "investments": result,
        "total": total_count,
        "skip": skip,
        "limit": limit
    }


class AdminInvestmentCreate(BaseModel):
    user_id: str
    amount: float
    plan_id: str


@api_router.post("/admin/investments/create")
async def admin_create_investment(
    investment_data: AdminInvestmentCreate,
    admin_user: dict = Depends(get_admin_user)
):
    """
    Admin can create an investment for any user directly (bypasses payment gateway).
    This also triggers direct income and level income distribution.
    """
    user_id = investment_data.user_id
    amount = investment_data.amount
    plan_id = investment_data.plan_id
    
    if amount < 20:
        raise HTTPException(status_code=400, detail="Minimum investment is $20")
    
    # Verify user exists
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get the investment plan
    plan = await db.investment_plans.find_one({"id": plan_id})
    if not plan:
        # Try to find by name for default plans
        plan = await db.investment_plans.find_one({"name": {"$regex": plan_id, "$options": "i"}})
    
    if not plan:
        # Use default values if plan not found
        plan = {
            "id": plan_id,
            "name": plan_id,
            "daily_roi": 1.0,
            "direct_income": 5.0,
            "validity_days": 100
        }
        # Note: Level income is now based on fixed slabs (user's own investment amount)
        # and is distributed when team members earn ROI, not at investment time
    
    # Generate investment ID
    investment_id = str(uuid.uuid4())
    order_id = f"ADM-{investment_id[:8].upper()}"
    
    # Check if this is user's first investment
    is_first_investment = user.get("status") == "inactive"
    
    # Create investment record (directly active)
    start_date = datetime.utcnow()
    end_date = start_date + timedelta(days=plan.get("validity_days", 100))
    
    new_investment = {
        "id": investment_id,
        "user_id": user_id,
        "amount": amount,
        "plan": plan_id,
        "plan_name": plan.get("name", plan_id),
        "cryptocurrency": "usdtbsc",
        "order_id": order_id,
        "date": start_date,
        "end_date": end_date,
        "status": "active",
        "validity_days": plan.get("validity_days", 100),
        "created_by_admin": True,
        "admin_id": admin_user["id"],
        "admin_email": admin_user["email"]
    }
    await db.investments.insert_one(new_investment)
    
    # Update user's wallet
    await db.wallets.update_one(
        {"user_id": user_id},
        {
            "$inc": {
                "total_invested": amount,
                "total_balance": amount
            }
        }
    )
    
    # Activate user if first investment
    if is_first_investment:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"status": "active"}}
        )
    
    # Create transaction record
    transaction = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": "investment",
        "amount": amount,
        "description": f"Investment of ${amount} - {plan.get('name', plan_id)} (Added by Admin)",
        "date": datetime.utcnow(),
        "investment_id": investment_id,
        "created_by_admin": True
    }
    await db.transactions.insert_one(transaction)
    
    # Process direct income (using plan's percentage)
    direct_income_percent = plan.get("direct_income", 5.0)
    direct_income_paid = 0
    
    if user.get("referred_by"):
        referrer = await db.users.find_one({"id": user["referred_by"]})
        
        if referrer and referrer.get("status") == "active":
            referral_amount = amount * (direct_income_percent / 100)
            direct_income_paid = referral_amount
            
            await db.wallets.update_one(
                {"user_id": user["referred_by"]},
                {
                    "$inc": {
                        "direct_income": referral_amount,
                        "total_balance": referral_amount
                    }
                }
            )
            
            # Record referral income
            referral_income = {
                "id": str(uuid.uuid4()),
                "user_id": user["referred_by"],
                "referred_user_id": user_id,
                "amount": referral_amount,
                "percentage": direct_income_percent,
                "date": datetime.utcnow()
            }
            await db.referral_income.insert_one(referral_income)
            
            # Create transaction for referrer
            referrer_transaction = {
                "id": str(uuid.uuid4()),
                "user_id": user["referred_by"],
                "type": "direct_income",
                "amount": referral_amount,
                "description": f"Direct referral income ({direct_income_percent}%) from {user['full_name']}",
                "date": datetime.utcnow()
            }
            await db.transactions.insert_one(referrer_transaction)
    
    # NOTE: Level income is distributed when team members earn Daily ROI,
    # not at investment time. See distribute_level_income_from_roi() function.
    
    return {
        "message": "Investment created successfully",
        "investment": {
            "id": investment_id,
            "user_id": user_id,
            "user_name": user["full_name"],
            "amount": amount,
            "plan": plan.get("name", plan_id),
            "status": "active",
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat()
        },
        "income_distributed": {
            "direct_income": direct_income_paid,
            "note": "Level income will be distributed when team earns Daily ROI"
        }
    }


@api_router.post("/admin/calculate-all-roi")
async def calculate_all_roi(admin_user: dict = Depends(get_admin_user)):
    """Calculate ROI for all users with active investments (excludes weekends and Dec 25)"""
    
    # Check if today is a working day
    today = datetime.utcnow()
    if not is_working_day(today):
        day_name = today.strftime("%A")
        reason = "Christmas Day (December 25)" if (today.month == 12 and today.day == 25) else f"{day_name} (non-working day)"
        return {
            "message": f"ROI not calculated - {reason}",
            "users_processed": 0,
            "total_roi_distributed": 0,
            "is_working_day": False
        }
    
    # Get all active investments
    active_investments = await db.investments.find({"status": "active"}).to_list(10000)
    
    roi_calculated = 0
    total_roi = 0
    level_income_distributions = 0
    processed_users = set()
    
    for investment in active_investments:
        user_id = investment["user_id"]
        
        # Skip if user already processed today
        if user_id in processed_users:
            continue
        
        # Get user's wallet
        wallet = await db.wallets.find_one({"user_id": user_id})
        if not wallet:
            continue
        
        # Check if ROI already calculated today
        if wallet.get("last_roi_date"):
            last_date = wallet["last_roi_date"].date()
            if last_date == today.date():
                continue
        
        # Get all user's active investments and calculate ROI
        user_investments = [inv for inv in active_investments if inv["user_id"] == user_id]
        user_total_roi = 0
        
        for inv in user_investments:
            plan_id = inv.get("plan", "premium")
            plan = await db.investment_plans.find_one({"id": plan_id})
            daily_roi_percent = plan.get("daily_roi", 1.0) if plan else 1.0
            roi_amount = inv.get("amount", 0) * (daily_roi_percent / 100)
            user_total_roi += roi_amount
        
        if user_total_roi <= 0:
            continue
        
        # Update wallet
        await db.wallets.update_one(
            {"user_id": user_id},
            {
                "$inc": {
                    "daily_roi": user_total_roi,
                    "total_balance": user_total_roi
                },
                "$set": {"last_roi_date": datetime.utcnow()}
            }
        )
        
        # Get user info for transaction
        user = await db.users.find_one({"id": user_id})
        user_name = user.get("full_name", "User") if user else "User"
        
        # Create transaction
        transaction = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": "daily_roi",
            "amount": user_total_roi,
            "description": f"Daily ROI - {today.strftime('%Y-%m-%d')}",
            "date": datetime.utcnow()
        }
        await db.transactions.insert_one(transaction)
        
        # Distribute level income to uplines
        if user:
            distributions = await distribute_level_income_from_roi(user_id, user_total_roi, user_name)
            level_income_distributions += len(distributions)
        
        roi_calculated += 1
        total_roi += user_total_roi
        processed_users.add(user_id)
    
    return {
        "message": f"ROI calculated for {roi_calculated} users",
        "users_processed": roi_calculated,
        "total_roi_distributed": total_roi,
        "level_income_distributions": level_income_distributions,
        "is_working_day": True
    }

@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, admin_user: dict = Depends(get_admin_user)):
    """Delete a user and all their data"""
    # Delete user
    await db.users.delete_one({"id": user_id})
    # Delete wallet
    await db.wallets.delete_one({"user_id": user_id})
    # Delete transactions
    await db.transactions.delete_many({"user_id": user_id})
    # Delete investments
    await db.investments.delete_many({"user_id": user_id})
    # Delete referral income
    await db.referral_income.delete_many({"user_id": user_id})
    
    return {"message": "User deleted successfully"}

# Toggle user status (active/inactive)
@api_router.post("/admin/users/{user_id}/toggle-status")
async def toggle_user_status(user_id: str, admin_user: dict = Depends(get_admin_user)):
    """Toggle user active/inactive status"""
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    current_status = user.get("status", "active")
    new_status = "inactive" if current_status == "active" else "active"
    
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"status": new_status}}
    )
    
    return {"message": f"User status changed to {new_status}", "status": new_status}

# ==================== WITHDRAWAL REQUESTS ====================

class WithdrawalRequest(BaseModel):
    amount: float
    wallet_type: str = "earning"  # which wallet to withdraw from
    bank_details: Optional[str] = None
    upi_id: Optional[str] = None

@api_router.post("/user/withdrawal-request")
async def create_withdrawal_request(
    request: WithdrawalRequest,
    current_user: dict = Depends(get_current_user)
):
    """User creates a withdrawal request"""
    wallet = await db.wallets.find_one({"user_id": current_user["id"]})
    if not wallet:
        raise HTTPException(status_code=400, detail="Wallet not found")
    
    # Calculate total available balance
    total_available = (
        wallet.get("daily_roi", 0) +
        wallet.get("direct_income", 0) +
        wallet.get("slab_income", 0) +
        wallet.get("royalty_income", 0) +
        wallet.get("salary_income", 0)
    )
    
    if request.amount > total_available:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid amount")
    
    withdrawal = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "amount": request.amount,
        "wallet_type": request.wallet_type,
        "bank_details": request.bank_details,
        "upi_id": request.upi_id,
        "status": "pending",  # pending, approved, cancelled
        "created_at": datetime.utcnow(),
        "processed_at": None,
        "processed_by": None
    }
    
    await db.withdrawals.insert_one(withdrawal)
    
    return {"message": "Withdrawal request submitted", "request_id": withdrawal["id"]}

@api_router.get("/user/withdrawals")
async def get_user_withdrawals(current_user: dict = Depends(get_current_user)):
    """Get current user's withdrawal requests"""
    withdrawals = await db.withdrawals.find(
        {"user_id": current_user["id"]}
    ).sort("created_at", -1).to_list(50)
    
    result = []
    for w in withdrawals:
        result.append({
            "id": w["id"],
            "amount": w["amount"],
            "status": w["status"],
            "request_timestamp": w["created_at"].isoformat() if hasattr(w["created_at"], 'isoformat') else str(w["created_at"]),
            "processed_at": w.get("processed_at")
        })
    
    return {"withdrawals": result}

@api_router.get("/admin/withdrawals")
async def get_all_withdrawals(
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    admin_user: dict = Depends(get_admin_user)
):
    """Get all withdrawal requests"""
    query = {}
    if status:
        query["status"] = status
    
    withdrawals = await db.withdrawals.find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    
    # Get totals
    total_pending = await db.withdrawals.count_documents({"status": "pending"})
    total_approved = await db.withdrawals.count_documents({"status": "approved"})
    total_cancelled = await db.withdrawals.count_documents({"status": "cancelled"})
    
    # Calculate total amounts
    pending_amount_result = await db.withdrawals.aggregate([
        {"$match": {"status": "pending"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    pending_amount = pending_amount_result[0]["total"] if pending_amount_result else 0
    
    approved_amount_result = await db.withdrawals.aggregate([
        {"$match": {"status": "approved"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    approved_amount = approved_amount_result[0]["total"] if approved_amount_result else 0
    
    cancelled_amount_result = await db.withdrawals.aggregate([
        {"$match": {"status": "cancelled"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    cancelled_amount = cancelled_amount_result[0]["total"] if cancelled_amount_result else 0
    
    # Enrich with user info
    result = []
    for w in withdrawals:
        user = await db.users.find_one({"id": w["user_id"]})
        result.append({
            "id": w["id"],
            "user_id": w["user_id"],
            "user_name": user["full_name"] if user else "Unknown",
            "user_email": user["email"] if user else "N/A",
            "user_number": user.get("user_number", "N/A") if user else "N/A",
            "amount": w["amount"],
            "wallet_type": w.get("wallet_type", "earning"),
            "bank_details": w.get("bank_details"),
            "upi_id": w.get("upi_id"),
            "status": w["status"],
            "created_at": w["created_at"].isoformat() if hasattr(w["created_at"], 'isoformat') else str(w["created_at"]),
            "processed_at": w["processed_at"].isoformat() if w.get("processed_at") and hasattr(w["processed_at"], 'isoformat') else None
        })
    
    return {
        "withdrawals": result,
        "summary": {
            "total_pending": total_pending,
            "total_approved": total_approved,
            "total_cancelled": total_cancelled,
            "pending_amount": pending_amount,
            "approved_amount": approved_amount,
            "cancelled_amount": cancelled_amount,
            "total_withdrawn": approved_amount
        }
    }

@api_router.post("/admin/withdrawals/{withdrawal_id}/approve")
async def approve_withdrawal(withdrawal_id: str, admin_user: dict = Depends(get_admin_user)):
    """Approve a withdrawal request"""
    withdrawal = await db.withdrawals.find_one({"id": withdrawal_id})
    if not withdrawal:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    
    if withdrawal["status"] != "pending":
        raise HTTPException(status_code=400, detail="Withdrawal already processed")
    
    # Deduct from user wallet (proportionally from all income types)
    wallet = await db.wallets.find_one({"user_id": withdrawal["user_id"]})
    if not wallet:
        raise HTTPException(status_code=400, detail="User wallet not found")
    
    amount = withdrawal["amount"]
    
    # Deduct proportionally
    total_income = (
        wallet.get("daily_roi", 0) +
        wallet.get("direct_income", 0) +
        wallet.get("slab_income", 0) +
        wallet.get("royalty_income", 0) +
        wallet.get("salary_income", 0)
    )
    
    if total_income < amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    # Simple deduction - deduct from available balances
    remaining = amount
    deductions = {}
    
    for income_type in ["daily_roi", "direct_income", "slab_income", "royalty_income", "salary_income"]:
        if remaining <= 0:
            break
        available = wallet.get(income_type, 0)
        deduct = min(available, remaining)
        if deduct > 0:
            deductions[income_type] = -deduct
            remaining -= deduct
    
    # Update wallet
    await db.wallets.update_one(
        {"user_id": withdrawal["user_id"]},
        {
            "$inc": {
                **deductions,
                "total_withdrawn": amount,
                "withdrawal_balance": amount
            }
        }
    )
    
    # Update withdrawal status
    await db.withdrawals.update_one(
        {"id": withdrawal_id},
        {
            "$set": {
                "status": "approved",
                "processed_at": datetime.utcnow(),
                "processed_by": admin_user["id"]
            }
        }
    )
    
    # Create transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "user_id": withdrawal["user_id"],
        "type": "withdrawal",
        "amount": -amount,
        "description": "Withdrawal approved",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(transaction)
    
    return {"message": "Withdrawal approved successfully"}

@api_router.post("/admin/withdrawals/{withdrawal_id}/cancel")
async def cancel_withdrawal(withdrawal_id: str, admin_user: dict = Depends(get_admin_user)):
    """Cancel a withdrawal request"""
    withdrawal = await db.withdrawals.find_one({"id": withdrawal_id})
    if not withdrawal:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    
    if withdrawal["status"] != "pending":
        raise HTTPException(status_code=400, detail="Withdrawal already processed")
    
    # Update withdrawal status
    await db.withdrawals.update_one(
        {"id": withdrawal_id},
        {
            "$set": {
                "status": "cancelled",
                "processed_at": datetime.utcnow(),
                "processed_by": admin_user["id"]
            }
        }
    )
    
    return {"message": "Withdrawal cancelled"}

# ==================== WALLETS MANAGEMENT ====================

@api_router.get("/admin/wallets")
async def get_all_wallets(admin_user: dict = Depends(get_admin_user)):
    """Get all wallets with user info"""
    wallets = await db.wallets.find().to_list(1000)
    
    wallet_list = []
    for wallet in wallets:
        user = await db.users.find_one({"id": wallet["user_id"]})
        if user:
            wallet_list.append({
                "user_id": wallet["user_id"],
                "user_email": user["email"],
                "user_name": user["full_name"],
                "daily_roi": wallet.get("daily_roi", 0),
                "direct_income": wallet.get("direct_income", 0),
                "slab_income": wallet.get("slab_income", 0),
                "royalty_income": wallet.get("royalty_income", 0),
                "salary_income": wallet.get("salary_income", 0),
                "total_invested": wallet.get("total_invested", 0)
            })
    
    return {"wallets": wallet_list}

# Income Credit/Debit Model
class IncomeCreditDebit(BaseModel):
    income_type: str  # daily_roi, direct_income, slab_income, royalty_income, salary_income
    amount: float
    description: str = ""

@api_router.post("/admin/users/{user_id}/credit-income")
async def credit_user_income(
    user_id: str,
    data: IncomeCreditDebit,
    admin_user: dict = Depends(get_admin_user)
):
    """Credit specific income type to user wallet"""
    valid_types = ["daily_roi", "direct_income", "slab_income", "royalty_income", "salary_income"]
    if data.income_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid income type. Must be one of: {valid_types}")
    
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    # Update wallet
    await db.wallets.update_one(
        {"user_id": user_id},
        {
            "$inc": {
                data.income_type: data.amount,
                "total_earned": data.amount
            }
        },
        upsert=True
    )
    
    # Create transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": data.income_type,
        "amount": data.amount,
        "description": data.description or f"{data.income_type} credit",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(transaction)
    
    return {"message": "Income credited successfully", "amount": data.amount, "type": data.income_type}

@api_router.post("/admin/users/{user_id}/debit-income")
async def debit_user_income(
    user_id: str,
    data: IncomeCreditDebit,
    admin_user: dict = Depends(get_admin_user)
):
    """Debit specific income type from user wallet"""
    valid_types = ["daily_roi", "direct_income", "slab_income", "royalty_income", "salary_income"]
    if data.income_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid income type. Must be one of: {valid_types}")
    
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    # Check balance
    wallet = await db.wallets.find_one({"user_id": user_id})
    if not wallet or wallet.get(data.income_type, 0) < data.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    # Update wallet
    await db.wallets.update_one(
        {"user_id": user_id},
        {
            "$inc": {
                data.income_type: -data.amount,
                "total_earned": -data.amount
            }
        }
    )
    
    # Create transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": f"{data.income_type}_debit",
        "amount": -data.amount,
        "description": data.description or f"{data.income_type} debit",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(transaction)
    
    return {"message": "Income debited successfully", "amount": data.amount, "type": data.income_type}

# ==================== INCOME CALCULATIONS ====================

def get_slab_rate(amount: float) -> float:
    """Get slab percentage based on investment amount"""
    if amount >= 1000000:  # $1M+
        return 0.45
    elif amount >= 500000:  # $500K - $1M
        return 0.40
    elif amount >= 200000:  # $200K - $500K
        return 0.35
    elif amount >= 100000:  # $100K - $200K
        return 0.30
    elif amount >= 50000:   # $50K - $100K
        return 0.25
    elif amount >= 25000:   # $25K - $50K
        return 0.20
    elif amount >= 10000:   # $10K - $25K
        return 0.15
    elif amount >= 5000:    # $5K - $10K
        return 0.10
    elif amount >= 1000:    # $1K - $5K
        return 0.05
    return 0

# ==================== SALARY INCOME MODEL ====================
# Business Volume -> Monthly Salary (for 10 months)
# $5,000  -> $15/month
# $10,000 -> $30/month
# $15,000 -> $45/month
# $30,000 -> $60/month
# Condition: 40% in Power Leg, 60% in Weaker Legs

SALARY_TIERS = [
    {"min_business": 30000, "monthly_salary": 60, "duration_months": 10},
    {"min_business": 15000, "monthly_salary": 45, "duration_months": 10},
    {"min_business": 10000, "monthly_salary": 30, "duration_months": 10},
    {"min_business": 5000, "monthly_salary": 15, "duration_months": 10},
]

def get_salary_tier(business_volume: float) -> dict:
    """Get salary tier based on business volume"""
    for tier in SALARY_TIERS:
        if business_volume >= tier["min_business"]:
            return tier
    return None

async def calculate_leg_business(user_id: str) -> dict:
    """Calculate business volume in each leg (direct referral and their downlines)"""
    # Get direct referrals
    direct_referrals = await db.users.find({"referred_by": user_id}).to_list(1000)
    
    if not direct_referrals:
        return {"power_leg": 0, "weaker_legs": 0, "total": 0, "legs": []}
    
    leg_volumes = []
    
    for referral in direct_referrals:
        # Calculate this leg's total business (referral + their downlines)
        leg_total = 0
        
        # Get referral's investment
        referral_wallet = await db.wallets.find_one({"user_id": referral["id"]})
        if referral_wallet:
            leg_total += referral_wallet.get("total_invested", 0)
        
        # Get all downlines of this referral (recursive)
        async def get_downline_business(parent_id: str) -> float:
            downlines = await db.users.find({"referred_by": parent_id}).to_list(1000)
            total = 0
            for dl in downlines:
                dl_wallet = await db.wallets.find_one({"user_id": dl["id"]})
                if dl_wallet:
                    total += dl_wallet.get("total_invested", 0)
                # Recursively get their downlines (limit depth to avoid infinite loops)
                total += await get_downline_business(dl["id"])
            return total
        
        leg_total += await get_downline_business(referral["id"])
        
        leg_volumes.append({
            "referral_id": referral["id"],
            "referral_name": referral["full_name"],
            "business": leg_total
        })
    
    # Sort legs by business volume (descending)
    leg_volumes.sort(key=lambda x: x["business"], reverse=True)
    
    # Power leg is the strongest leg
    power_leg = leg_volumes[0]["business"] if leg_volumes else 0
    
    # Weaker legs are all other legs combined
    weaker_legs = sum(leg["business"] for leg in leg_volumes[1:]) if len(leg_volumes) > 1 else 0
    
    total_business = power_leg + weaker_legs
    
    return {
        "power_leg": power_leg,
        "weaker_legs": weaker_legs,
        "total": total_business,
        "legs": leg_volumes
    }

def check_salary_eligibility(power_leg: float, weaker_legs: float, total: float) -> dict:
    """Check if user meets 40% power leg / 60% weaker legs condition"""
    if total <= 0:
        return {"eligible": False, "reason": "No business volume"}
    
    power_leg_percent = (power_leg / total) * 100
    weaker_legs_percent = (weaker_legs / total) * 100
    
    # Condition: Power leg should be at most 40%, weaker legs at least 60%
    # This ensures balanced growth across multiple legs
    is_eligible = power_leg_percent <= 40 and weaker_legs_percent >= 60
    
    return {
        "eligible": is_eligible,
        "power_leg_percent": round(power_leg_percent, 2),
        "weaker_legs_percent": round(weaker_legs_percent, 2),
        "reason": "Eligible" if is_eligible else f"Power leg is {power_leg_percent:.1f}% (max 40%), Weaker legs need to be at least 60%"
    }

@api_router.get("/user/salary-status")
async def get_user_salary_status(current_user: dict = Depends(get_current_user)):
    """Get user's salary eligibility status and current tier"""
    leg_business = await calculate_leg_business(current_user["id"])
    eligibility = check_salary_eligibility(
        leg_business["power_leg"],
        leg_business["weaker_legs"],
        leg_business["total"]
    )
    
    salary_tier = get_salary_tier(leg_business["total"]) if eligibility["eligible"] else None
    
    # Get user's salary record
    salary_record = await db.salary_records.find_one({"user_id": current_user["id"]})
    
    months_paid = 0
    months_remaining = 0
    current_tier_name = "None"
    
    if salary_record:
        months_paid = salary_record.get("months_paid", 0)
        months_remaining = salary_record.get("duration_months", 10) - months_paid
        current_tier_name = f"${salary_record.get('monthly_salary', 0)}/month"
    
    return {
        "business_volume": {
            "total": leg_business["total"],
            "power_leg": leg_business["power_leg"],
            "weaker_legs": leg_business["weaker_legs"],
            "legs_breakdown": leg_business["legs"][:5]  # Top 5 legs
        },
        "eligibility": eligibility,
        "salary_tier": salary_tier,
        "current_salary": {
            "active": salary_record is not None and months_remaining > 0,
            "monthly_amount": salary_record.get("monthly_salary", 0) if salary_record else 0,
            "months_paid": months_paid,
            "months_remaining": max(0, months_remaining),
            "total_earned": salary_record.get("total_paid", 0) if salary_record else 0
        }
    }

@api_router.post("/admin/calculate-salary-income")
async def calculate_salary_income(admin_user: dict = Depends(get_admin_user)):
    """Calculate and distribute monthly salary income to eligible users"""
    users = await db.users.find({"is_admin": {"$ne": True}}).to_list(1000)
    
    processed = 0
    total_distributed = 0
    results = []
    
    for user in users:
        # Calculate leg business
        leg_business = await calculate_leg_business(user["id"])
        
        if leg_business["total"] < 5000:  # Minimum business required
            continue
        
        # Check eligibility (40/60 rule)
        eligibility = check_salary_eligibility(
            leg_business["power_leg"],
            leg_business["weaker_legs"],
            leg_business["total"]
        )
        
        if not eligibility["eligible"]:
            continue
        
        # Get salary tier
        salary_tier = get_salary_tier(leg_business["total"])
        if not salary_tier:
            continue
        
        # Check existing salary record
        salary_record = await db.salary_records.find_one({"user_id": user["id"]})
        
        if salary_record:
            # Check if already paid this month
            last_payment = salary_record.get("last_payment_date")
            if last_payment and last_payment.month == datetime.utcnow().month and last_payment.year == datetime.utcnow().year:
                continue
            
            # Check if all months are paid
            if salary_record.get("months_paid", 0) >= salary_record.get("duration_months", 10):
                continue
            
            # Pay this month's salary
            monthly_salary = salary_record.get("monthly_salary", salary_tier["monthly_salary"])
            
            await db.salary_records.update_one(
                {"user_id": user["id"]},
                {
                    "$inc": {"months_paid": 1, "total_paid": monthly_salary},
                    "$set": {"last_payment_date": datetime.utcnow()}
                }
            )
        else:
            # Create new salary record
            monthly_salary = salary_tier["monthly_salary"]
            
            await db.salary_records.insert_one({
                "user_id": user["id"],
                "business_volume": leg_business["total"],
                "monthly_salary": monthly_salary,
                "duration_months": salary_tier["duration_months"],
                "months_paid": 1,
                "total_paid": monthly_salary,
                "start_date": datetime.utcnow(),
                "last_payment_date": datetime.utcnow()
            })
        
        # Credit salary to user's wallet
        await db.wallets.update_one(
            {"user_id": user["id"]},
            {
                "$inc": {
                    "salary_income": monthly_salary,
                    "total_earned": monthly_salary
                }
            }
        )
        
        # Create transaction
        transaction = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "type": "salary_income",
            "amount": monthly_salary,
            "description": f"Monthly Salary (Business: ${leg_business['total']:,.0f})",
            "date": datetime.utcnow()
        }
        await db.transactions.insert_one(transaction)
        
        processed += 1
        total_distributed += monthly_salary
        
        results.append({
            "user": user["full_name"],
            "user_number": user.get("user_number"),
            "business_volume": leg_business["total"],
            "monthly_salary": monthly_salary,
            "power_leg_percent": eligibility["power_leg_percent"],
            "weaker_legs_percent": eligibility["weaker_legs_percent"]
        })
    
    return {
        "message": f"Salary income distributed to {processed} users",
        "users_processed": processed,
        "total_distributed": total_distributed,
        "details": results
    }

@api_router.get("/admin/salary-status")
async def get_all_salary_status(admin_user: dict = Depends(get_admin_user)):
    """Get salary status for all users"""
    users = await db.users.find({"is_admin": {"$ne": True}}).to_list(1000)
    
    results = []
    
    for user in users:
        leg_business = await calculate_leg_business(user["id"])
        eligibility = check_salary_eligibility(
            leg_business["power_leg"],
            leg_business["weaker_legs"],
            leg_business["total"]
        )
        salary_tier = get_salary_tier(leg_business["total"])
        salary_record = await db.salary_records.find_one({"user_id": user["id"]})
        
        results.append({
            "user_id": user["id"],
            "user_number": user.get("user_number"),
            "full_name": user["full_name"],
            "business_volume": leg_business["total"],
            "power_leg": leg_business["power_leg"],
            "weaker_legs": leg_business["weaker_legs"],
            "eligible": eligibility["eligible"],
            "power_leg_percent": eligibility["power_leg_percent"],
            "weaker_legs_percent": eligibility["weaker_legs_percent"],
            "current_tier": f"${salary_tier['monthly_salary']}/month" if salary_tier else "None",
            "months_paid": salary_record.get("months_paid", 0) if salary_record else 0,
            "months_remaining": (salary_record.get("duration_months", 10) - salary_record.get("months_paid", 0)) if salary_record else 0,
            "total_salary_earned": salary_record.get("total_paid", 0) if salary_record else 0
        })
    
    # Sort by business volume
    results.sort(key=lambda x: x["business_volume"], reverse=True)
    
    return {"users": results}

@api_router.post("/admin/calculate-daily-roi")
async def calculate_daily_roi(
    roi_type: str = "regular",  # premium (1%) or regular (0.5%)
    admin_user: dict = Depends(get_admin_user)
):
    """Calculate daily ROI for all users with investments"""
    rate = 0.01 if roi_type == "premium" else 0.005
    rate_name = "Premium 1%" if roi_type == "premium" else "Regular 0.5%"
    
    wallets = await db.wallets.find({"total_invested": {"$gt": 0}}).to_list(1000)
    
    processed = 0
    total_distributed = 0
    
    for wallet in wallets:
        # Check if already calculated today
        if wallet.get("last_roi_date"):
            last_date = wallet["last_roi_date"].date()
            today = datetime.utcnow().date()
            if last_date == today:
                continue
        
        investment = wallet.get("total_invested", 0)
        roi_amount = investment * rate
        
        if roi_amount > 0:
            # Update wallet
            await db.wallets.update_one(
                {"user_id": wallet["user_id"]},
                {
                    "$inc": {
                        "daily_roi": roi_amount,
                        "total_earned": roi_amount
                    },
                    "$set": {"last_roi_date": datetime.utcnow()}
                }
            )
            
            # Create transaction
            transaction = {
                "id": str(uuid.uuid4()),
                "user_id": wallet["user_id"],
                "type": "daily_roi",
                "amount": roi_amount,
                "description": f"Daily ROI ({rate_name})",
                "date": datetime.utcnow()
            }
            await db.transactions.insert_one(transaction)
            
            processed += 1
            total_distributed += roi_amount
    
    return {
        "message": f"ROI calculated for {processed} users",
        "users_processed": processed,
        "total_distributed": total_distributed,
        "rate": rate_name
    }

@api_router.post("/admin/calculate-direct-income")
async def calculate_direct_income(admin_user: dict = Depends(get_admin_user)):
    """Calculate 5% direct income for referrers on new investments"""
    # Find investments that haven't had direct income calculated
    investments = await db.investments.find({"direct_income_paid": {"$ne": True}}).to_list(1000)
    
    processed = 0
    total_distributed = 0
    
    for investment in investments:
        # Find the user who made this investment
        user = await db.users.find_one({"id": investment["user_id"]})
        if not user or not user.get("referred_by"):
            continue
        
        # Find the referrer
        referrer = await db.users.find_one({"id": user["referred_by"]})
        if not referrer:
            continue
        
        # Calculate 5% direct income
        direct_amount = investment["amount"] * 0.05
        
        # Credit referrer
        await db.wallets.update_one(
            {"user_id": referrer["id"]},
            {
                "$inc": {
                    "direct_income": direct_amount,
                    "total_earned": direct_amount
                }
            }
        )
        
        # Create transaction
        transaction = {
            "id": str(uuid.uuid4()),
            "user_id": referrer["id"],
            "type": "direct_income",
            "amount": direct_amount,
            "description": f"5% Direct Income from {user['full_name']}",
            "date": datetime.utcnow()
        }
        await db.transactions.insert_one(transaction)
        
        # Mark investment as processed
        await db.investments.update_one(
            {"_id": investment["_id"]},
            {"$set": {"direct_income_paid": True}}
        )
        
        processed += 1
        total_distributed += direct_amount
    
    return {
        "message": f"Direct income calculated for {processed} investments",
        "investments_processed": processed,
        "total_distributed": total_distributed
    }

@api_router.post("/admin/calculate-slab-income")
async def calculate_slab_income(admin_user: dict = Depends(get_admin_user)):
    """Calculate slab income based on team investment volume"""
    users = await db.users.find({"is_admin": {"$ne": True}}).to_list(1000)
    
    processed = 0
    total_distributed = 0
    
    for user in users:
        # Get all direct referrals
        referrals = await db.users.find({"referred_by": user["id"]}).to_list(1000)
        
        if not referrals:
            continue
        
        # Calculate total team investment
        team_investment = 0
        for referral in referrals:
            wallet = await db.wallets.find_one({"user_id": referral["id"]})
            if wallet:
                team_investment += wallet.get("total_invested", 0)
        
        if team_investment < 1000:
            continue
        
        # Get slab rate
        slab_rate = get_slab_rate(team_investment)
        slab_amount = team_investment * slab_rate
        
        # Check if already calculated this month
        user_wallet = await db.wallets.find_one({"user_id": user["id"]})
        last_slab_date = user_wallet.get("last_slab_date") if user_wallet else None
        
        if last_slab_date:
            if last_slab_date.month == datetime.utcnow().month:
                continue
        
        # Credit slab income
        await db.wallets.update_one(
            {"user_id": user["id"]},
            {
                "$inc": {
                    "slab_income": slab_amount,
                    "total_earned": slab_amount
                },
                "$set": {"last_slab_date": datetime.utcnow()}
            }
        )
        
        # Create transaction
        transaction = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "type": "slab_income",
            "amount": slab_amount,
            "description": f"Slab Income ({int(slab_rate*100)}% on ${team_investment:.2f})",
            "date": datetime.utcnow()
        }
        await db.transactions.insert_one(transaction)
        
        processed += 1
        total_distributed += slab_amount
    
    return {
        "message": f"Slab income calculated for {processed} users",
        "users_processed": processed,
        "total_distributed": total_distributed
    }

@api_router.post("/admin/calculate-royalty-income")
async def calculate_royalty_income(admin_user: dict = Depends(get_admin_user)):
    """Calculate royalty income: Level 1 = 10%, Level 2 = 5%, Level 3 = 5%"""
    users = await db.users.find({"is_admin": {"$ne": True}}).to_list(1000)
    
    processed = 0
    total_distributed = 0
    
    for user in users:
        # Get today's earnings from direct referrals (Level 1)
        level1_referrals = await db.users.find({"referred_by": user["id"]}).to_list(100)
        
        for l1 in level1_referrals:
            # Get Level 1 earnings (last day)
            yesterday = datetime.utcnow() - timedelta(days=1)
            l1_earnings = await db.transactions.find({
                "user_id": l1["id"],
                "type": {"$in": ["daily_roi", "investment"]},
                "date": {"$gte": yesterday}
            }).to_list(100)
            
            l1_total = sum(t["amount"] for t in l1_earnings if t["amount"] > 0)
            
            if l1_total > 0:
                # 10% royalty from Level 1
                royalty_l1 = l1_total * 0.10
                await db.wallets.update_one(
                    {"user_id": user["id"]},
                    {"$inc": {"royalty_income": royalty_l1, "total_earned": royalty_l1}}
                )
                
                transaction = {
                    "id": str(uuid.uuid4()),
                    "user_id": user["id"],
                    "type": "royalty_income",
                    "amount": royalty_l1,
                    "description": f"L1 Royalty 10% from {l1['full_name']}",
                    "date": datetime.utcnow()
                }
                await db.transactions.insert_one(transaction)
                total_distributed += royalty_l1
            
            # Level 2 (referrals of Level 1)
            level2_referrals = await db.users.find({"referred_by": l1["id"]}).to_list(100)
            
            for l2 in level2_referrals:
                l2_earnings = await db.transactions.find({
                    "user_id": l2["id"],
                    "type": {"$in": ["daily_roi", "investment"]},
                    "date": {"$gte": yesterday}
                }).to_list(100)
                
                l2_total = sum(t["amount"] for t in l2_earnings if t["amount"] > 0)
                
                if l2_total > 0:
                    # 5% royalty from Level 2
                    royalty_l2 = l2_total * 0.05
                    await db.wallets.update_one(
                        {"user_id": user["id"]},
                        {"$inc": {"royalty_income": royalty_l2, "total_earned": royalty_l2}}
                    )
                    
                    transaction = {
                        "id": str(uuid.uuid4()),
                        "user_id": user["id"],
                        "type": "royalty_income",
                        "amount": royalty_l2,
                        "description": f"L2 Royalty 5% from {l2['full_name']}",
                        "date": datetime.utcnow()
                    }
                    await db.transactions.insert_one(transaction)
                    total_distributed += royalty_l2
                
                # Level 3 (referrals of Level 2)
                level3_referrals = await db.users.find({"referred_by": l2["id"]}).to_list(100)
                
                for l3 in level3_referrals:
                    l3_earnings = await db.transactions.find({
                        "user_id": l3["id"],
                        "type": {"$in": ["daily_roi", "investment"]},
                        "date": {"$gte": yesterday}
                    }).to_list(100)
                    
                    l3_total = sum(t["amount"] for t in l3_earnings if t["amount"] > 0)
                    
                    if l3_total > 0:
                        # 5% royalty from Level 3
                        royalty_l3 = l3_total * 0.05
                        await db.wallets.update_one(
                            {"user_id": user["id"]},
                            {"$inc": {"royalty_income": royalty_l3, "total_earned": royalty_l3}}
                        )
                        
                        transaction = {
                            "id": str(uuid.uuid4()),
                            "user_id": user["id"],
                            "type": "royalty_income",
                            "amount": royalty_l3,
                            "description": f"L3 Royalty 5% from {l3['full_name']}",
                            "date": datetime.utcnow()
                        }
                        await db.transactions.insert_one(transaction)
                        total_distributed += royalty_l3
        
        processed += 1
    
    return {
        "message": f"Royalty income calculated for {processed} users",
        "users_processed": processed,
        "total_distributed": total_distributed
    }

# ==================== LEARNING CENTER ROUTES ====================

def extract_youtube_id(url: str) -> str:
    """Extract YouTube video ID from various URL formats"""
    import re
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)',
        r'youtube\.com\/shorts\/([^&\n?#]+)'
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return url  # Return as-is if no match

@api_router.get("/learning/videos")
async def get_learning_videos():
    """Get all active learning videos for users"""
    videos = await db.learning_videos.find(
        {"is_active": True},
        {"_id": 0}
    ).sort("display_order", 1).to_list(100)
    
    return {"videos": videos}

@api_router.get("/admin/learning/videos")
async def get_admin_learning_videos(admin_user: dict = Depends(get_admin_user)):
    """Get all learning videos (admin)"""
    videos = await db.learning_videos.find({}, {"_id": 0}).sort("display_order", 1).to_list(100)
    
    total = len(videos)
    active = sum(1 for v in videos if v.get("is_active", True))
    
    return {
        "videos": videos,
        "summary": {"total": total, "active": active}
    }

@api_router.post("/admin/learning/videos")
async def create_learning_video(video: VideoCreate, admin_user: dict = Depends(get_admin_user)):
    """Add a new learning video"""
    video_id = str(uuid.uuid4())
    youtube_id = extract_youtube_id(video.youtube_url)
    
    video_doc = {
        "id": video_id,
        "title": video.title,
        "youtube_url": video.youtube_url,
        "youtube_id": youtube_id,
        "thumbnail_url": f"https://img.youtube.com/vi/{youtube_id}/mqdefault.jpg",
        "description": video.description,
        "category": video.category,
        "display_order": video.display_order,
        "is_active": video.is_active,
        "created_by": admin_user.get("email"),
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    await db.learning_videos.insert_one(video_doc)
    
    return {"success": True, "message": "Video added successfully", "video_id": video_id}

@api_router.put("/admin/learning/videos/{video_id}")
async def update_learning_video(
    video_id: str, 
    video: VideoUpdate, 
    admin_user: dict = Depends(get_admin_user)
):
    """Update a learning video"""
    update_data = {k: v for k, v in video.dict().items() if v is not None}
    
    if "youtube_url" in update_data:
        youtube_id = extract_youtube_id(update_data["youtube_url"])
        update_data["youtube_id"] = youtube_id
        update_data["thumbnail_url"] = f"https://img.youtube.com/vi/{youtube_id}/mqdefault.jpg"
    
    update_data["updated_at"] = datetime.utcnow()
    
    result = await db.learning_videos.update_one(
        {"id": video_id},
        {"$set": update_data}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Video not found")
    
    return {"success": True, "message": "Video updated successfully"}

@api_router.delete("/admin/learning/videos/{video_id}")
async def delete_learning_video(video_id: str, admin_user: dict = Depends(get_admin_user)):
    """Delete a learning video"""
    result = await db.learning_videos.delete_one({"id": video_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Video not found")
    
    return {"success": True, "message": "Video deleted successfully"}

# ==================== ADMIN SUPPORT TICKET ROUTES ====================

@api_router.get("/admin/tickets")
async def get_all_tickets(
    status: Optional[str] = None,
    admin_user: dict = Depends(get_admin_user)
):
    """Get all support tickets (admin only)"""
    query = {}
    if status:
        query["status"] = status
    
    tickets = await db.tickets.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    
    # Calculate summary
    all_tickets = await db.tickets.find({}, {"status": 1}).to_list(1000)
    summary = {
        "total": len(all_tickets),
        "open": sum(1 for t in all_tickets if t.get("status") == "open"),
        "in_progress": sum(1 for t in all_tickets if t.get("status") == "in_progress"),
        "resolved": sum(1 for t in all_tickets if t.get("status") == "resolved"),
        "closed": sum(1 for t in all_tickets if t.get("status") == "closed")
    }
    
    return {"tickets": tickets, "summary": summary}

@api_router.get("/admin/tickets/{ticket_id}")
async def get_ticket_admin(ticket_id: str, admin_user: dict = Depends(get_admin_user)):
    """Get ticket details (admin)"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    return ticket

@api_router.post("/admin/tickets/{ticket_id}/reply")
async def admin_reply_to_ticket(
    ticket_id: str, 
    reply: TicketReply, 
    admin_user: dict = Depends(get_admin_user)
):
    """Add an admin reply to a ticket"""
    ticket = await db.tickets.find_one({"id": ticket_id})
    
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    new_message = {
        "id": str(uuid.uuid4()),
        "sender": "admin",
        "sender_name": admin_user.get("full_name", "Admin"),
        "message": reply.message,
        "timestamp": datetime.utcnow()
    }
    
    await db.tickets.update_one(
        {"id": ticket_id},
        {
            "$push": {"messages": new_message},
            "$set": {"updated_at": datetime.utcnow(), "status": "in_progress"}
        }
    )
    
    return {"success": True, "message": "Reply added successfully"}

@api_router.put("/admin/tickets/{ticket_id}/status")
async def update_ticket_status(
    ticket_id: str, 
    status_update: TicketStatusUpdate, 
    admin_user: dict = Depends(get_admin_user)
):
    """Update ticket status (admin)"""
    valid_statuses = ["open", "in_progress", "resolved", "closed"]
    if status_update.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    result = await db.tickets.update_one(
        {"id": ticket_id},
        {"$set": {"status": status_update.status, "updated_at": datetime.utcnow()}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    return {"success": True, "message": f"Ticket status updated to {status_update.status}"}

@api_router.delete("/admin/tickets/{ticket_id}")
async def delete_ticket(ticket_id: str, admin_user: dict = Depends(get_admin_user)):
    """Delete a ticket (admin)"""
    result = await db.tickets.delete_one({"id": ticket_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    return {"success": True, "message": "Ticket deleted successfully"}

# ==================== P2P WALLET TRANSFER ====================

class P2PTransferRequest(BaseModel):
    recipient_user_number: int  # The user_number of the recipient (e.g., 100001)
    amount: float

class P2PVerifyOTP(BaseModel):
    transfer_id: str
    otp: str

def generate_otp() -> str:
    """Generate a 6-digit OTP"""
    return str(random.randint(100000, 999999))

async def send_otp_email(email: str, otp: str, amount: float, recipient_name: str) -> bool:
    """Send OTP via email using Resend"""
    if not RESEND_API_KEY:
        # If no API key, log OTP for testing
        logging.info(f"[TEST MODE] OTP for {email}: {otp}")
        return True
    
    html_content = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #f39c12, #e67e22); padding: 20px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; text-align: center;">SS Money Resource</h1>
        </div>
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333;">P2P Transfer Verification</h2>
            <p style="color: #666; font-size: 16px;">
                You have initiated a transfer of <strong style="color: #f39c12;">${amount:.2f}</strong> 
                to <strong>{recipient_name}</strong>.
            </p>
            <div style="background: #fff; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <p style="color: #666; margin: 0 0 10px 0;">Your OTP Code:</p>
                <h1 style="color: #f39c12; letter-spacing: 8px; margin: 0; font-size: 36px;">{otp}</h1>
            </div>
            <p style="color: #999; font-size: 14px;">
                This OTP is valid for 10 minutes. Do not share this code with anyone.
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 30px;">
                If you did not initiate this transfer, please contact support immediately.
            </p>
        </div>
    </div>
    """
    
    try:
        params = {
            "from": SENDER_EMAIL,
            "to": [email],
            "subject": f"SS Money Resource - P2P Transfer OTP: {otp}",
            "html": html_content
        }
        await asyncio.to_thread(resend.Emails.send, params)
        return True
    except Exception as e:
        logging.error(f"Failed to send OTP email: {str(e)}")
        return False

@api_router.post("/p2p/initiate-transfer")
async def initiate_p2p_transfer(
    request: P2PTransferRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Initiate a P2P transfer - sends OTP to sender's email
    Only transfers from Main Wallet are allowed
    """
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    # Get sender's wallet
    sender_wallet = await db.wallets.find_one({"user_id": current_user["id"]})
    if not sender_wallet:
        raise HTTPException(status_code=400, detail="Wallet not found")
    
    # Calculate main wallet balance (sum of all income types)
    main_wallet_balance = (
        sender_wallet.get("daily_roi", 0) +
        sender_wallet.get("direct_income", 0) +
        sender_wallet.get("slab_income", 0) +
        sender_wallet.get("royalty_income", 0) +
        sender_wallet.get("salary_income", 0)
    )
    
    if request.amount > main_wallet_balance:
        raise HTTPException(status_code=400, detail=f"Insufficient balance. Available: ${main_wallet_balance:.2f}")
    
    # Find recipient by user_number
    recipient = await db.users.find_one({"user_number": request.recipient_user_number})
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found. Please check the User ID.")
    
    if recipient["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot transfer to yourself")
    
    if recipient.get("status") == "inactive":
        raise HTTPException(status_code=400, detail="Recipient account is inactive")
    
    # Generate OTP and transfer ID
    otp = generate_otp()
    transfer_id = str(uuid.uuid4())
    
    # Store OTP with transfer details (expires in 10 minutes)
    otp_storage[transfer_id] = {
        "otp": otp,
        "sender_id": current_user["id"],
        "recipient_id": recipient["id"],
        "recipient_name": recipient["full_name"],
        "recipient_user_number": recipient["user_number"],
        "amount": request.amount,
        "created_at": datetime.utcnow(),
        "expires_at": datetime.utcnow() + timedelta(minutes=10),
        "verified": False
    }
    
    # Send OTP email
    email_sent = await send_otp_email(
        current_user["email"],
        otp,
        request.amount,
        recipient["full_name"]
    )
    
    if not email_sent and RESEND_API_KEY:
        raise HTTPException(status_code=500, detail="Failed to send OTP. Please try again.")
    
    return {
        "message": "OTP sent to your email",
        "transfer_id": transfer_id,
        "recipient_name": recipient["full_name"],
        "recipient_user_number": recipient["user_number"],
        "amount": request.amount,
        "otp_sent_to": current_user["email"],
        "expires_in_minutes": 10
    }

@api_router.post("/p2p/verify-transfer")
async def verify_p2p_transfer(
    request: P2PVerifyOTP,
    current_user: dict = Depends(get_current_user)
):
    """
    Verify OTP and complete the P2P transfer
    """
    # Get transfer details
    transfer = otp_storage.get(request.transfer_id)
    
    if not transfer:
        raise HTTPException(status_code=400, detail="Invalid or expired transfer. Please initiate a new transfer.")
    
    # Verify sender
    if transfer["sender_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="Unauthorized transfer")
    
    # Check expiry
    if datetime.utcnow() > transfer["expires_at"]:
        del otp_storage[request.transfer_id]
        raise HTTPException(status_code=400, detail="OTP expired. Please initiate a new transfer.")
    
    # Verify OTP
    if transfer["otp"] != request.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    
    if transfer["verified"]:
        raise HTTPException(status_code=400, detail="Transfer already completed")
    
    amount = transfer["amount"]
    
    # Re-check sender's balance
    sender_wallet = await db.wallets.find_one({"user_id": current_user["id"]})
    main_wallet_balance = (
        sender_wallet.get("daily_roi", 0) +
        sender_wallet.get("direct_income", 0) +
        sender_wallet.get("slab_income", 0) +
        sender_wallet.get("royalty_income", 0) +
        sender_wallet.get("salary_income", 0)
    )
    
    if amount > main_wallet_balance:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    # Deduct from sender (proportionally from all income types)
    remaining = amount
    deductions = {}
    
    for income_type in ["daily_roi", "direct_income", "slab_income", "royalty_income", "salary_income"]:
        if remaining <= 0:
            break
        available = sender_wallet.get(income_type, 0)
        deduct = min(available, remaining)
        if deduct > 0:
            deductions[income_type] = -deduct
            remaining -= deduct
    
    # Update sender's wallet
    await db.wallets.update_one(
        {"user_id": current_user["id"]},
        {"$inc": deductions}
    )
    
    # Credit recipient's main wallet (add to daily_roi as default receiving wallet)
    await db.wallets.update_one(
        {"user_id": transfer["recipient_id"]},
        {"$inc": {"daily_roi": amount, "total_earned": amount}},
        upsert=True
    )
    
    # Create transaction for sender
    sender_transaction = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "type": "p2p_transfer_out",
        "amount": -amount,
        "description": f"P2P Transfer to #{transfer['recipient_user_number']} ({transfer['recipient_name']})",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(sender_transaction)
    
    # Create transaction for recipient
    sender_user = await db.users.find_one({"id": current_user["id"]})
    recipient_transaction = {
        "id": str(uuid.uuid4()),
        "user_id": transfer["recipient_id"],
        "type": "p2p_transfer_in",
        "amount": amount,
        "description": f"P2P Transfer from #{sender_user.get('user_number', 'N/A')} ({current_user['full_name']})",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(recipient_transaction)
    
    # Store transfer record in DB
    transfer_record = {
        "id": request.transfer_id,
        "sender_id": current_user["id"],
        "sender_user_number": sender_user.get("user_number"),
        "recipient_id": transfer["recipient_id"],
        "recipient_user_number": transfer["recipient_user_number"],
        "amount": amount,
        "status": "completed",
        "created_at": transfer["created_at"],
        "completed_at": datetime.utcnow()
    }
    await db.p2p_transfers.insert_one(transfer_record)
    
    # Mark as verified and clean up
    transfer["verified"] = True
    del otp_storage[request.transfer_id]
    
    return {
        "message": "Transfer successful",
        "amount": amount,
        "recipient": transfer["recipient_name"],
        "recipient_user_number": transfer["recipient_user_number"],
        "transfer_id": request.transfer_id
    }

@api_router.get("/p2p/transfer-history")
async def get_p2p_transfer_history(current_user: dict = Depends(get_current_user)):
    """Get P2P transfer history for current user"""
    # Get transfers where user is sender or recipient
    transfers = await db.p2p_transfers.find({
        "$or": [
            {"sender_id": current_user["id"]},
            {"recipient_id": current_user["id"]}
        ]
    }).sort("completed_at", -1).limit(50).to_list(50)
    
    result = []
    for t in transfers:
        is_sender = t["sender_id"] == current_user["id"]
        
        if is_sender:
            other_user = await db.users.find_one({"id": t["recipient_id"]})
            result.append({
                "id": t["id"],
                "type": "sent",
                "amount": -t["amount"],
                "other_user_number": t["recipient_user_number"],
                "other_user_name": other_user["full_name"] if other_user else "Unknown",
                "date": t["completed_at"].isoformat() if hasattr(t["completed_at"], 'isoformat') else str(t["completed_at"])
            })
        else:
            other_user = await db.users.find_one({"id": t["sender_id"]})
            result.append({
                "id": t["id"],
                "type": "received",
                "amount": t["amount"],
                "other_user_number": t["sender_user_number"],
                "other_user_name": other_user["full_name"] if other_user else "Unknown",
                "date": t["completed_at"].isoformat() if hasattr(t["completed_at"], 'isoformat') else str(t["completed_at"])
            })
    
    return {"transfers": result}

@api_router.get("/p2p/lookup-user/{user_number}")
async def lookup_user_by_number(user_number: int, current_user: dict = Depends(get_current_user)):
    """Look up a user by their user number for P2P transfer"""
    user = await db.users.find_one({"user_number": user_number})
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user["id"] == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot lookup yourself")
    
    return {
        "user_number": user["user_number"],
        "full_name": user["full_name"],
        "status": user.get("status", "active")
    }

# ==================== ADMIN P2P TRANSFER ====================

class AdminP2PTransfer(BaseModel):
    sender_user_number: int
    recipient_user_number: int
    amount: float
    description: str = ""

@api_router.post("/admin/p2p/transfer")
async def admin_p2p_transfer(
    request: AdminP2PTransfer,
    admin_user: dict = Depends(get_admin_user)
):
    """Admin can directly transfer funds between users without OTP"""
    if request.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    
    # Find sender
    sender = await db.users.find_one({"user_number": request.sender_user_number})
    if not sender:
        raise HTTPException(status_code=404, detail="Sender not found")
    
    # Find recipient
    recipient = await db.users.find_one({"user_number": request.recipient_user_number})
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    if sender["id"] == recipient["id"]:
        raise HTTPException(status_code=400, detail="Sender and recipient cannot be the same")
    
    # Get sender's wallet and check balance
    sender_wallet = await db.wallets.find_one({"user_id": sender["id"]})
    if not sender_wallet:
        raise HTTPException(status_code=400, detail="Sender wallet not found")
    
    main_wallet_balance = (
        sender_wallet.get("daily_roi", 0) +
        sender_wallet.get("direct_income", 0) +
        sender_wallet.get("slab_income", 0) +
        sender_wallet.get("royalty_income", 0) +
        sender_wallet.get("salary_income", 0)
    )
    
    if request.amount > main_wallet_balance:
        raise HTTPException(status_code=400, detail=f"Insufficient balance. Sender has ${main_wallet_balance:.2f}")
    
    # Deduct from sender
    remaining = request.amount
    deductions = {}
    
    for income_type in ["daily_roi", "direct_income", "slab_income", "royalty_income", "salary_income"]:
        if remaining <= 0:
            break
        available = sender_wallet.get(income_type, 0)
        deduct = min(available, remaining)
        if deduct > 0:
            deductions[income_type] = -deduct
            remaining -= deduct
    
    await db.wallets.update_one(
        {"user_id": sender["id"]},
        {"$inc": deductions}
    )
    
    # Credit recipient
    await db.wallets.update_one(
        {"user_id": recipient["id"]},
        {"$inc": {"daily_roi": request.amount, "total_earned": request.amount}},
        upsert=True
    )
    
    # Create transactions
    transfer_id = str(uuid.uuid4())
    desc_suffix = f" - {request.description}" if request.description else ""
    
    sender_transaction = {
        "id": str(uuid.uuid4()),
        "user_id": sender["id"],
        "type": "admin_p2p_transfer_out",
        "amount": -request.amount,
        "description": f"Admin P2P Transfer to #{request.recipient_user_number}{desc_suffix}",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(sender_transaction)
    
    recipient_transaction = {
        "id": str(uuid.uuid4()),
        "user_id": recipient["id"],
        "type": "admin_p2p_transfer_in",
        "amount": request.amount,
        "description": f"Admin P2P Transfer from #{request.sender_user_number}{desc_suffix}",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(recipient_transaction)
    
    # Store transfer record
    transfer_record = {
        "id": transfer_id,
        "sender_id": sender["id"],
        "sender_user_number": sender["user_number"],
        "recipient_id": recipient["id"],
        "recipient_user_number": recipient["user_number"],
        "amount": request.amount,
        "status": "completed",
        "admin_initiated": True,
        "admin_id": admin_user["id"],
        "description": request.description,
        "created_at": datetime.utcnow(),
        "completed_at": datetime.utcnow()
    }
    await db.p2p_transfers.insert_one(transfer_record)
    
    return {
        "message": "Transfer successful",
        "transfer_id": transfer_id,
        "amount": request.amount,
        "sender": {
            "user_number": sender["user_number"],
            "name": sender["full_name"]
        },
        "recipient": {
            "user_number": recipient["user_number"],
            "name": recipient["full_name"]
        }
    }

@api_router.get("/admin/p2p/transfers")
async def get_admin_p2p_transfers(
    skip: int = 0,
    limit: int = 100,
    admin_user: dict = Depends(get_admin_user)
):
    """Get all P2P transfers for admin"""
    transfers = await db.p2p_transfers.find().sort("completed_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.p2p_transfers.count_documents({})
    
    result = []
    for t in transfers:
        sender = await db.users.find_one({"id": t["sender_id"]})
        recipient = await db.users.find_one({"id": t["recipient_id"]})
        
        result.append({
            "id": t["id"],
            "sender_user_number": t["sender_user_number"],
            "sender_name": sender["full_name"] if sender else "Unknown",
            "recipient_user_number": t["recipient_user_number"],
            "recipient_name": recipient["full_name"] if recipient else "Unknown",
            "amount": t["amount"],
            "status": t["status"],
            "admin_initiated": t.get("admin_initiated", False),
            "description": t.get("description", ""),
            "completed_at": t["completed_at"].isoformat() if hasattr(t["completed_at"], 'isoformat') else str(t["completed_at"])
        })
    
    return {
        "transfers": result,
        "total": total,
        "skip": skip,
        "limit": limit
    }

# Serve admin panel and website
from fastapi.responses import FileResponse, HTMLResponse

# Define base paths - check multiple possible locations
def get_website_path():
    possible_paths = [
        Path(__file__).parent / "website",  # /app/backend/website (deployed together)
        Path(__file__).parent.parent / "website",  # /app/website (development)
        Path("/app/website"),  # Absolute path fallback
    ]
    for p in possible_paths:
        if p.exists() and (p / "index.html").exists():
            return p
    return possible_paths[0]  # Default to first option

WEBSITE_DIR = get_website_path()
logging.info(f"Website directory: {WEBSITE_DIR}")

# Website routes - serve static marketing website (under /api prefix for ingress routing)
@api_router.get("/website", response_class=HTMLResponse)
async def serve_website_root():
    website_file = WEBSITE_DIR / "index.html"
    if website_file.exists():
        return FileResponse(website_file, media_type="text/html")
    raise HTTPException(status_code=404, detail=f"Website not found at {website_file}")

@api_router.get("/website/", response_class=HTMLResponse)
async def serve_website_root_slash():
    website_file = WEBSITE_DIR / "index.html"
    if website_file.exists():
        return FileResponse(website_file, media_type="text/html")
    raise HTTPException(status_code=404, detail=f"Website not found at {website_file}")

@api_router.get("/website/{file_path:path}")
async def serve_website_files(file_path: str):
    website_file = WEBSITE_DIR / file_path
    if website_file.exists() and website_file.is_file():
        # Set correct MIME types
        media_type = "text/plain"
        if file_path.endswith('.css'):
            media_type = "text/css"
        elif file_path.endswith('.js'):
            media_type = "application/javascript"
        elif file_path.endswith('.html'):
            media_type = "text/html"
        elif file_path.endswith('.jpg') or file_path.endswith('.jpeg'):
            media_type = "image/jpeg"
        elif file_path.endswith('.png'):
            media_type = "image/png"
        elif file_path.endswith('.svg'):
            media_type = "image/svg+xml"
        return FileResponse(website_file, media_type=media_type)
    raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

# Admin panel routes
@api_router.get("/admin", response_class=HTMLResponse)
async def serve_admin_root():
    admin_file = Path(__file__).parent / "admin" / "index.html"
    if admin_file.exists():
        return FileResponse(admin_file, media_type="text/html")
    raise HTTPException(status_code=404, detail="Admin panel not found")

@api_router.get("/admin/", response_class=HTMLResponse)
async def serve_admin_root_slash():
    admin_file = Path(__file__).parent / "admin" / "index.html"
    if admin_file.exists():
        return FileResponse(admin_file, media_type="text/html")
    raise HTTPException(status_code=404, detail="Admin panel not found")

@api_router.get("/admin/{file_path:path}")
async def serve_admin_files(file_path: str):
    admin_file = Path(__file__).parent / "admin" / file_path
    if admin_file.exists() and admin_file.is_file():
        # Set correct MIME types
        media_type = "text/plain"
        if file_path.endswith('.css'):
            media_type = "text/css"
        elif file_path.endswith('.js'):
            media_type = "application/javascript"
        elif file_path.endswith('.html'):
            media_type = "text/html"
        return FileResponse(admin_file, media_type=media_type)
    raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

# User Web App Routes
@api_router.get("/user", response_class=HTMLResponse)
async def serve_user_root():
    user_file = Path(__file__).parent / "user" / "index.html"
    if user_file.exists():
        return FileResponse(user_file, media_type="text/html")
    raise HTTPException(status_code=404, detail="User app not found")

@api_router.get("/user/", response_class=HTMLResponse)
async def serve_user_root_slash():
    user_file = Path(__file__).parent / "user" / "index.html"
    if user_file.exists():
        return FileResponse(user_file, media_type="text/html")
    raise HTTPException(status_code=404, detail="User app not found")

@api_router.get("/user/{file_path:path}")
async def serve_user_files(file_path: str):
    user_file = Path(__file__).parent / "user" / file_path
    if user_file.exists() and user_file.is_file():
        media_type = "application/octet-stream"
        if file_path.endswith('.css'):
            media_type = "text/css"
        elif file_path.endswith('.js'):
            media_type = "application/javascript"
        elif file_path.endswith('.html'):
            media_type = "text/html"
        elif file_path.endswith('.json'):
            media_type = "application/json"
        elif file_path.endswith('.png'):
            media_type = "image/png"
        elif file_path.endswith('.jpg') or file_path.endswith('.jpeg'):
            media_type = "image/jpeg"
        elif file_path.endswith('.svg'):
            media_type = "image/svg+xml"
        elif file_path.endswith('.ico'):
            media_type = "image/x-icon"
        elif file_path.endswith('.webp'):
            media_type = "image/webp"
        return FileResponse(user_file, media_type=media_type)
    raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== DAILY ROI CRON JOB ====================
scheduler = AsyncIOScheduler()

async def scheduled_daily_roi_calculation():
    """
    Scheduled job to calculate and distribute daily ROI at midnight (12:00 AM).
    This runs automatically every day and skips weekends and Dec 25.
    """
    logging.info("=== SCHEDULED DAILY ROI CALCULATION STARTED ===")
    
    today = datetime.utcnow()
    
    # Check if today is a working day
    if not is_working_day(today):
        day_name = today.strftime("%A")
        reason = "Christmas Day" if (today.month == 12 and today.day == 25) else f"{day_name}"
        logging.info(f"Skipping ROI calculation - {reason} (non-working day)")
        return
    
    try:
        # Get all active investments
        active_investments = await db.investments.find({"status": "active"}).to_list(10000)
        
        roi_calculated = 0
        total_roi = 0
        level_income_distributions = 0
        processed_users = set()
        
        for investment in active_investments:
            user_id = investment["user_id"]
            
            # Skip if user already processed today
            if user_id in processed_users:
                continue
            
            # Get user's wallet
            wallet = await db.wallets.find_one({"user_id": user_id})
            if not wallet:
                continue
            
            # Check if ROI already calculated today
            if wallet.get("last_roi_date"):
                last_date = wallet["last_roi_date"].date()
                if last_date == today.date():
                    continue
            
            # Get all user's active investments and calculate ROI
            user_investments = [inv for inv in active_investments if inv["user_id"] == user_id]
            user_total_roi = 0
            
            for inv in user_investments:
                plan_id = inv.get("plan", "premium")
                plan = await db.investment_plans.find_one({"id": plan_id})
                daily_roi_percent = plan.get("daily_roi", 1.0) if plan else 1.0
                roi_amount = inv.get("amount", 0) * (daily_roi_percent / 100)
                user_total_roi += roi_amount
            
            if user_total_roi <= 0:
                continue
            
            # Update wallet
            await db.wallets.update_one(
                {"user_id": user_id},
                {
                    "$inc": {
                        "daily_roi": user_total_roi,
                        "total_balance": user_total_roi
                    },
                    "$set": {"last_roi_date": datetime.utcnow()}
                }
            )
            
            # Get user info for transaction
            user = await db.users.find_one({"id": user_id})
            user_name = user.get("full_name", "User") if user else "User"
            
            # Create transaction
            transaction = {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "type": "daily_roi",
                "amount": user_total_roi,
                "description": f"Daily ROI - {today.strftime('%Y-%m-%d')} (Auto-credited)",
                "date": datetime.utcnow()
            }
            await db.transactions.insert_one(transaction)
            
            # Distribute level income to uplines
            if user:
                distributions = await distribute_level_income_from_roi(user_id, user_total_roi, user_name)
                level_income_distributions += len(distributions)
            
            roi_calculated += 1
            total_roi += user_total_roi
            processed_users.add(user_id)
        
        logging.info(f"=== DAILY ROI COMPLETED: {roi_calculated} users, ${total_roi:.2f} distributed, {level_income_distributions} level income distributions ===")
        
        # Store cron execution log
        await db.cron_logs.insert_one({
            "job": "daily_roi",
            "executed_at": datetime.utcnow(),
            "users_processed": roi_calculated,
            "total_roi_distributed": total_roi,
            "level_income_distributions": level_income_distributions,
            "is_working_day": True
        })
        
    except Exception as e:
        logging.error(f"Error in scheduled ROI calculation: {str(e)}")

@app.on_event("startup")
async def start_scheduler():
    """Start the background scheduler for daily ROI calculations"""
    # Run daily at 00:00 IST (India Standard Time)
    # IST is UTC+5:30, so 00:00 IST = 18:30 UTC (previous day)
    scheduler.add_job(
        scheduled_daily_roi_calculation,
        CronTrigger(hour=18, minute=30),  # 12:00 AM IST = 6:30 PM UTC
        id="daily_roi_job",
        replace_existing=True
    )
    scheduler.start()
    logging.info("Daily ROI scheduler started - will run at 00:00 IST (18:30 UTC) daily")

@app.on_event("shutdown")
async def shutdown_scheduler():
    """Shutdown the scheduler gracefully"""
    scheduler.shutdown()
    client.close()
