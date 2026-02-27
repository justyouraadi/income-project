from fastapi import FastAPI, APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
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

# In-memory OTP storage (for production, use Redis or DB)
otp_storage: Dict[str, dict] = {}

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
    """Look up a referrer by referral code or user number"""
    # Remove # prefix if present
    clean_code = code.lstrip('#')
    
    # Try to find by user_number first (if it's a number)
    try:
        user_number = int(clean_code)
        referrer = await db.users.find_one({"user_number": user_number})
        if referrer:
            return {
                "found": True,
                "name": referrer["full_name"],
                "user_number": referrer["user_number"],
                "referral_code": referrer["referral_code"]
            }
    except ValueError:
        pass
    
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
        clean_code = user_data.referral_code.lstrip('#')
        
        # Try to find by user_number first (if it's a number)
        try:
            user_number_ref = int(clean_code)
            referrer = await db.users.find_one({"user_number": user_number_ref})
        except ValueError:
            pass
        
        # If not found by number, try by referral_code
        if not referrer:
            referrer = await db.users.find_one({"referral_code": clean_code.upper()})
        if not referrer:
            referrer = await db.users.find_one({"referral_code": clean_code})
        
        if not referrer:
            raise HTTPException(status_code=400, detail="Invalid referral code")
    
    # Generate unique user ID number (6 digits starting from 100001)
    last_user = await db.users.find_one(sort=[("user_number", -1)])
    user_number = (last_user.get("user_number", 100000) + 1) if last_user else 100001
    
    # Create user
    user_id = str(uuid.uuid4())
    hashed_password = get_password_hash(user_data.password)
    referral_code = generate_referral_code()
    
    user = {
        "id": user_id,
        "user_number": user_number,  # Unique numeric ID
        "email": user_data.email,
        "password": hashed_password,
        "full_name": user_data.full_name,
        "referral_code": referral_code,
        "referred_by": referrer["id"] if referrer else None,
        "status": "active",  # active or inactive
        "created_at": datetime.utcnow()
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
        "total_investment": current_user.get("total_investment", 0),
        "total_withdrawn": current_user.get("total_withdrawn", 0),
        "team_size": current_user.get("team_size", 0),
        "joined_date": current_user.get("created_at")
    }

# ==================== WALLET ROUTES ====================

@api_router.get("/wallet", response_model=Wallet)
async def get_wallet(current_user: dict = Depends(get_current_user)):
    wallet = await db.wallets.find_one({"user_id": current_user["id"]})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    return wallet

@api_router.post("/wallet/invest")
async def create_investment(amount: float, current_user: dict = Depends(get_current_user)):
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Invalid amount")
    
    # Update wallet - add to total invested
    await db.wallets.update_one(
        {"user_id": current_user["id"]},
        {
            "$inc": {
                "total_invested": amount,
                "total_balance": amount
            }
        }
    )
    
    # Create investment record
    investment = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "amount": amount,
        "date": datetime.utcnow(),
        "status": "active"
    }
    await db.investments.insert_one(investment)
    
    # Create transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "type": "investment",
        "amount": amount,
        "description": f"Investment of ${amount}",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(transaction)
    
    # Process referral income (5% direct income)
    if current_user.get("referred_by"):
        referral_amount = amount * 0.05
        await db.wallets.update_one(
            {"user_id": current_user["referred_by"]},
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
            "user_id": current_user["referred_by"],
            "referred_user_id": current_user["id"],
            "amount": referral_amount,
            "date": datetime.utcnow()
        }
        await db.referral_income.insert_one(referral_income)
        
        # Create transaction for referrer
        referrer_transaction = {
            "id": str(uuid.uuid4()),
            "user_id": current_user["referred_by"],
            "type": "direct_income",
            "amount": referral_amount,
            "description": f"Direct referral income from {current_user['full_name']}",
            "date": datetime.utcnow()
        }
        await db.transactions.insert_one(referrer_transaction)
    
    return {"message": "Investment successful", "amount": amount}

@api_router.post("/wallet/calculate-roi")
async def calculate_daily_roi(current_user: dict = Depends(get_current_user)):
    """Calculate and credit 1.5% daily ROI"""
    wallet = await db.wallets.find_one({"user_id": current_user["id"]})
    
    if wallet["total_invested"] <= 0:
        return {"message": "No active investment", "roi": 0}
    
    # Check if ROI already calculated today
    if wallet.get("last_roi_date"):
        last_date = wallet["last_roi_date"].date()
        today = datetime.utcnow().date()
        if last_date == today:
            return {"message": "ROI already calculated today", "roi": 0}
    
    # Calculate 1.5% daily ROI
    roi_amount = wallet["total_invested"] * 0.015
    
    # Update wallet
    await db.wallets.update_one(
        {"user_id": current_user["id"]},
        {
            "$inc": {
                "daily_roi": roi_amount,
                "total_balance": roi_amount
            },
            "$set": {"last_roi_date": datetime.utcnow()}
        }
    )
    
    # Create transaction
    transaction = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "type": "daily_roi",
        "amount": roi_amount,
        "description": "Daily ROI (1.5%)",
        "date": datetime.utcnow()
    }
    await db.transactions.insert_one(transaction)
    
    return {"message": "ROI calculated successfully", "roi": roi_amount}

# ==================== TRANSACTION ROUTES ====================

@api_router.get("/transactions", response_model=List[Transaction])
async def get_transactions(current_user: dict = Depends(get_current_user)):
    transactions = await db.transactions.find(
        {"user_id": current_user["id"]}
    ).sort("date", -1).limit(50).to_list(50)
    return transactions

# ==================== TEAM/REFERRAL ROUTES ====================

@api_router.get("/team/members", response_model=List[TeamMember])
async def get_team_members(current_user: dict = Depends(get_current_user)):
    # Get direct referrals
    referrals = await db.users.find({"referred_by": current_user["id"]}).to_list(100)
    
    team_members = []
    for referral in referrals:
        wallet = await db.wallets.find_one({"user_id": referral["id"]})
        team_members.append({
            "user_id": referral["id"],
            "full_name": referral["full_name"],
            "email": referral["email"],
            "joined_date": referral["created_at"],
            "total_investment": wallet.get("total_invested", 0) if wallet else 0,
            "level": 1
        })
    
    return team_members

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
    
    # Calculate daily ROI potential
    daily_roi = wallet.get("total_invested", 0) * 0.015
    
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

@api_router.post("/admin/calculate-all-roi")
async def calculate_all_roi(admin_user: dict = Depends(get_admin_user)):
    """Calculate ROI for all users"""
    wallets = await db.wallets.find({"investment_balance": {"$gt": 0}}).to_list(1000)
    
    roi_calculated = 0
    total_roi = 0
    
    for wallet in wallets:
        # Check if ROI already calculated today
        if wallet.get("last_roi_date"):
            last_date = wallet["last_roi_date"].date()
            today = datetime.utcnow().date()
            if last_date == today:
                continue
        
        # Calculate 1.5% ROI
        roi_amount = wallet["investment_balance"] * 0.015
        
        # Update wallet
        await db.wallets.update_one(
            {"user_id": wallet["user_id"]},
            {
                "$inc": {
                    "earning_balance": roi_amount,
                    "total_earned": roi_amount
                },
                "$set": {"last_roi_date": datetime.utcnow()}
            }
        )
        
        # Create transaction
        transaction = {
            "id": str(uuid.uuid4()),
            "user_id": wallet["user_id"],
            "type": "roi",
            "amount": roi_amount,
            "description": "Daily ROI (1.5%)",
            "date": datetime.utcnow()
        }
        await db.transactions.insert_one(transaction)
        
        roi_calculated += 1
        total_roi += roi_amount
    
    return {
        "message": f"ROI calculated for {roi_calculated} users",
        "users_processed": roi_calculated,
        "total_roi_distributed": total_roi
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

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()