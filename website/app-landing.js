// Smooth animations on load
document.addEventListener('DOMContentLoaded', function() {
    // Animate floating cards
    const cards = document.querySelectorAll('.floating-card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        setTimeout(() => {
            card.style.transition = 'all 0.6s ease-out';
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 1000 + (index * 200));
    });
    
    // Animate features on scroll
    const observerOptions = {
        threshold: 0.2,
        rootMargin: '0px 0px -100px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Observe elements
    document.querySelectorAll('.feature-showcase-card, .income-list-item, .testimonial-content').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.6s ease-out';
        observer.observe(el);
    });
    
    // Animate chart bars
    const chartBars = document.querySelectorAll('.chart-bar');
    const chartObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                chartBars.forEach((bar, index) => {
                    setTimeout(() => {
                        bar.style.animation = 'barGrow 1s ease-out forwards';
                    }, index * 150);
                });
                chartObserver.disconnect();
            }
        });
    }, { threshold: 0.5 });
    
    const incomeChart = document.querySelector('.income-chart');
    if (incomeChart) {
        chartObserver.observe(incomeChart);
    }
});

// Download button handlers
document.querySelectorAll('.download-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        alert('Download will be available soon! The app is being prepared for launch on App Store and Google Play.');
    });
});

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});
