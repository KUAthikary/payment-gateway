```
// server.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const https = require('https');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Global configuration object
let CONFIG = null;

// Function to fetch configuration from GitHub
const loadConfig = async () => {
  return new Promise((resolve, reject) => {
    const url = 'https://raw.githubusercontent.com/BeeBotix/researchsummits_Webpage/refs/heads/main/stripe-config.json';
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const config = JSON.parse(data);
          resolve(config);
        } catch (error) {
          console.error('Error parsing config JSON:', error);
          reject(error);
        }
      });
    }).on('error', (error) => {
      console.error('Error fetching config:', error);
      reject(error);
    });
  });
};

// Stripe configuration from GitHub
const getStripeConfig = async () => {
  if (!CONFIG) {
    try {
      CONFIG = await loadConfig();
    } catch (error) {
      console.error('Failed to load config, using fallbacks:', error);
      CONFIG = { stripe: {} }; // Fallback empty config
    }
  }
  
  return {
    // Publishable key from GitHub config
    publishableKey: CONFIG.stripe?.publishableKey || process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_fallback',
    
    // Secret key from GitHub config (TEST KEYS ONLY)
    secretKey: CONFIG.stripe?.secretKey || process.env.STRIPE_SECRET_KEY || 'sk_test_fallback'
  };
};

// Initialize Stripe (will be set after config loads)
let stripe = null;

// Utility function to fetch events data from GitHub
const loadEvents = async () => {
  return new Promise((resolve, reject) => {
    // Use URL from config if available, otherwise fallback
    const url = CONFIG?.endpoints?.eventsUrl || 'https://raw.githubusercontent.com/BeeBotix/researchsummits_Webpage/refs/heads/main/events.json';
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const events = JSON.parse(data);
          resolve(events);
        } catch (error) {
          console.error('Error parsing events JSON:', error);
          reject(error);
        }
      });
    }).on('error', (error) => {
      console.error('Error fetching events:', error);
      reject(error);
    });
  });
};

// Initialize application with configuration
const initializeApp = async () => {
  try {
    // Load configuration and initialize Stripe
    const stripeConfig = await getStripeConfig();
    stripe = require('stripe')(stripeConfig.secretKey);
    
    console.log('✅ Configuration loaded successfully');
    console.log('🔑 Stripe initialized with keys from GitHub config');
    
    // Store publishable key for frontend use
    app.locals.stripePublishableKey = stripeConfig.publishableKey;
    
  } catch (error) {
    console.error('❌ Failed to initialize app configuration:', error);
    process.exit(1);
  }
};

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      frameSrc: ["https://js.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com"]
    }
  }
}));
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============================================================================
// HOME PAGE ROUTE - REDIRECT TO MAIN WEBSITE
// ============================================================================
app.get('/', (req, res) => {
  const redirectUrl = CONFIG?.endpoints?.redirectUrl || 'http://researchsummits.com/index.html';
  res.redirect(redirectUrl);
});

// ============================================================================
// PAYMENT PAGE ROUTE - ENHANCED AESTHETIC DESIGN
// ============================================================================
app.get('/payment/:eventId', async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const events = await loadEvents();
    const event = events.find(e => e.eventId === eventId);
    
    if (!event) {
      const backUrl = CONFIG?.endpoints?.redirectUrl || 'http://researchsummits.com/index.html';
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Conference Not Found - Research Summits</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
            <style>
              body { 
                font-family: 'Inter', sans-serif; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white; 
                text-align: center; 
                padding: 100px 20px; 
                margin: 0;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              .container { 
                max-width: 600px; 
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(20px);
                border-radius: 20px;
                padding: 40px;
                border: 1px solid rgba(255,255,255,0.2);
              }
              h1 { font-size: 72px; margin-bottom: 20px; font-weight: 900; }
              p { font-size: 18px; margin-bottom: 30px; opacity: 0.9; }
              a { 
                color: #60a5fa; 
                text-decoration: none; 
                font-weight: 600;
                padding: 15px 30px;
                border: 2px solid #60a5fa;
                border-radius: 50px;
                display: inline-block;
                transition: all 0.3s ease;
                background: rgba(96,165,250,0.1);
              }
              a:hover { 
                background: #60a5fa; 
                color: white; 
                transform: translateY(-2px);
                box-shadow: 0 10px 25px rgba(96,165,250,0.3);
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>404</h1>
              <p>The requested conference event was not found.</p>
              <a href="${backUrl}">← Back to Research Summits</a>
            </div>
          </body>
        </html>
      `);
    }

    // Check for custom payment amount in query parameter
    const customPay = req.query.pay;
    let eventCost = event.cost; // Default from JSON
    
    // If custom pay amount is provided, validate and use it
    if (customPay) {
      const customAmount = parseFloat(customPay);
      if (isNaN(customAmount) || customAmount <= 0) {
        return res.status(400).send(`
          <html>
            <body style="font-family: 'Inter', sans-serif; text-align: center; padding: 100px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
              <h1>Invalid Payment Amount</h1>
              <p>Please provide a valid payment amount.</p>
              <a href="${CONFIG?.endpoints?.redirectUrl || 'http://researchsummits.com/index.html'}" style="color: #60a5fa; text-decoration: none; font-weight: 600;">← Back to Research Summits</a>
            </body>
          </html>
        `);
      }
      
      // Set reasonable limits (minimum $1, maximum $10,000)
      if (customAmount < 1 || customAmount > 10000) {
        return res.status(400).send(`
          <html>
            <body style="font-family: 'Inter', sans-serif; text-align: center; padding: 100px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
              <h1>Invalid Payment Amount</h1>
              <p>Payment amount must be between $1 and $10,000.</p>
              <a href="${CONFIG?.endpoints?.redirectUrl || 'http://researchsummits.com/index.html'}" style="color: #60a5fa; text-decoration: none; font-weight: 600;">← Back to Research Summits</a>
            </body>
          </html>
        `);
      }
      
      eventCost = customAmount;
      console.log(`💰 Custom payment amount: ${eventCost} for event ${eventId}`);
    }

    // Use the dynamically loaded publishable key
    const publishableKey = app.locals.stripePublishableKey;
    const backUrl = CONFIG?.endpoints?.redirectUrl || 'http://researchsummits.com/index.html';

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Registration - ${event.eventName}</title>
          <script src="https://js.stripe.com/v3/"></script>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
          <style>
              * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
              }
              
              body {
                  font-family: 'Inter', sans-serif;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
                  min-height: 100vh;
                  padding: 20px;
                  position: relative;
                  overflow-x: hidden;
              }
              
              body::before {
                  content: '';
                  position: fixed;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs><radialGradient id="a" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23ffffff" stop-opacity="0.1"/><stop offset="100%" stop-color="%23ffffff" stop-opacity="0"/></radialGradient></defs><circle cx="200" cy="200" r="100" fill="url(%23a)"/><circle cx="800" cy="300" r="150" fill="url(%23a)"/><circle cx="300" cy="700" r="120" fill="url(%23a)"/><circle cx="700" cy="800" r="80" fill="url(%23a)"/></svg>') no-repeat center center;
                  background-size: cover;
                  pointer-events: none;
                  z-index: -1;
              }
              
              .container {
                  max-width: 680px;
                  margin: 0 auto;
                  animation: slideInUp 1s ease-out;
              }
              
              @keyframes slideInUp {
                  0% { opacity: 0; transform: translateY(50px); }
                  100% { opacity: 1; transform: translateY(0); }
              }
              
              .back-link {
                  display: inline-flex;
                  align-items: center;
                  gap: 10px;
                  color: white;
                  text-decoration: none;
                  font-weight: 600;
                  margin-bottom: 30px;
                  padding: 12px 20px;
                  border-radius: 50px;
                  background: rgba(255, 255, 255, 0.15);
                  backdrop-filter: blur(10px);
                  border: 1px solid rgba(255, 255, 255, 0.2);
                  transition: all 0.3s ease;
                  font-size: 14px;
              }
              
              .back-link:hover {
                  background: rgba(255, 255, 255, 0.25);
                  transform: translateX(-5px);
                  box-shadow: 0 8px 25px rgba(0,0,0,0.1);
              }
              
              .payment-card {
                  background: rgba(255, 255, 255, 0.98);
                  backdrop-filter: blur(25px);
                  border-radius: 32px;
                  overflow: hidden;
                  box-shadow: 0 40px 80px rgba(0, 0, 0, 0.15);
                  border: 1px solid rgba(255, 255, 255, 0.3);
                  position: relative;
              }
              
              .payment-card::before {
                  content: '';
                  position: absolute;
                  top: 0;
                  left: 0;
                  right: 0;
                  height: 6px;
                  background: linear-gradient(90deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
              }
              
              .event-header {
                  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
                  padding: 60px 50px;
                  text-align: center;
                  position: relative;
                  overflow: hidden;
              }
              
              .event-header::before {
                  content: '';
                  position: absolute;
                  top: -50%;
                  left: -50%;
                  width: 200%;
                  height: 200%;
                  background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
                  animation: rotate 20s linear infinite;
              }
              
              @keyframes rotate {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
              }
              
              .event-title {
                  font-size: 36px;
                  font-weight: 900;
                  color: white;
                  margin-bottom: 16px;
                  line-height: 1.2;
                  position: relative;
                  z-index: 1;
              }
              
              .event-desc {
                  color: rgba(255, 255, 255, 0.9);
                  font-size: 18px;
                  line-height: 1.6;
                  margin-bottom: 30px;
                  font-weight: 400;
                  position: relative;
                  z-index: 1;
              }
              
              .event-price {
                  font-size: 56px;
                  font-weight: 900;
                  color: #f093fb;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 8px;
                  position: relative;
                  z-index: 1;
                  text-shadow: 0 4px 20px rgba(240, 147, 251, 0.3);
              }
              
              .currency {
                  font-size: 40px;
                  opacity: 0.9;
              }
              
              .form-container {
                  padding: 60px 50px;
                  background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
              }
              
              .form-row {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 25px;
                  margin-bottom: 30px;
              }
              
              .form-group {
                  margin-bottom: 30px;
                  position: relative;
              }
              
              .input-label {
                  display: block;
                  margin-bottom: 10px;
                  font-weight: 700;
                  color: #1e293b;
                  font-size: 14px;
                  text-transform: uppercase;
                  letter-spacing: 1.2px;
              }
              
              .input-field {
                  width: 100%;
                  padding: 20px 24px;
                  border: 2px solid #e2e8f0;
                  border-radius: 20px;
                  font-size: 16px;
                  font-family: inherit;
                  background: #ffffff;
                  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                  font-weight: 500;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.04);
              }
              
              .input-field:focus {
                  outline: none;
                  border-color: #667eea;
                  background: #ffffff;
                  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.15), 0 8px 25px rgba(0,0,0,0.1);
                  transform: translateY(-2px);
              }
              
              .card-container {
                  background: #ffffff;
                  border: 2px solid #e2e8f0;
                  border-radius: 20px;
                  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                  box-shadow: 0 4px 12px rgba(0,0,0,0.04);
              }
              
              .card-container.focused {
                  border-color: #667eea;
                  background: #ffffff;
                  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.15), 0 8px 25px rgba(0,0,0,0.1);
                  transform: translateY(-2px);
              }
              
              #card-element {
                  padding: 20px 24px;
              }
              
              .payment-button {
                  width: 100%;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  border: none;
                  padding: 24px;
                  border-radius: 20px;
                  font-size: 18px;
                  font-weight: 800;
                  cursor: pointer;
                  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                  margin-top: 20px;
                  text-transform: uppercase;
                  letter-spacing: 1.5px;
                  box-shadow: 0 12px 35px rgba(102, 126, 234, 0.4);
                  position: relative;
                  overflow: hidden;
              }
              
              .payment-button::before {
                  content: '';
                  position: absolute;
                  top: 0;
                  left: -100%;
                  width: 100%;
                  height: 100%;
                  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
                  transition: left 0.5s;
              }
              
              .payment-button:hover::before {
                  left: 100%;
              }
              
              .payment-button:hover {
                  transform: translateY(-4px);
                  box-shadow: 0 20px 40px rgba(102, 126, 234, 0.5);
              }
              
              .payment-button:disabled {
                  opacity: 0.7;
                  cursor: not-allowed;
                  transform: none;
              }
              
              .loading-overlay {
                  display: none;
                  position: fixed;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  background: rgba(0, 0, 0, 0.6);
                  backdrop-filter: blur(12px);
                  z-index: 1000;
                  align-items: center;
                  justify-content: center;
              }
              
              .loading-content {
                  background: rgba(255, 255, 255, 0.95);
                  backdrop-filter: blur(20px);
                  padding: 50px;
                  border-radius: 30px;
                  text-align: center;
                  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.3);
                  border: 1px solid rgba(255,255,255,0.3);
              }
              
              .spinner {
                  width: 80px;
                  height: 80px;
                  border: 6px solid #f1f5f9;
                  border-top: 6px solid #667eea;
                  border-radius: 50%;
                  animation: spin 1.2s linear infinite;
                  margin: 0 auto 25px;
              }
              
              @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
              }
              
              .loading-text {
                  font-size: 20px;
                  font-weight: 700;
                  color: #1e293b;
              }
              
              .error-message {
                  color: #ef4444;
                  font-size: 14px;
                  margin-top: 12px;
                  font-weight: 600;
                  padding: 16px;
                  background: linear-gradient(135deg, #fef2f2 0%, #fff5f5 100%);
                  border: 2px solid #fecaca;
                  border-radius: 16px;
                  animation: shake 0.5s ease-in-out;
              }
              
              @keyframes shake {
                  0%, 100% { transform: translateX(0); }
                  25% { transform: translateX(-5px); }
                  75% { transform: translateX(5px); }
              }
              
              .security-info {
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  gap: 15px;
                  margin-top: 30px;
                  padding: 20px;
                  background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
                  border: 2px solid #bbf7d0;
                  border-radius: 20px;
                  font-size: 15px;
                  color: #065f46;
                  font-weight: 600;
                  position: relative;
                  overflow: hidden;
              }
              
              .security-info::before {
                  content: '🔒';
                  font-size: 20px;
              }
              
              .footer-credit {
                  text-align: center;
                  margin-top: 25px;
                  padding: 15px;
                  font-size: 13px;
                  color: rgba(107, 114, 128, 0.7);
                  font-weight: 500;
              }
              
              .footer-credit strong {
                  font-weight: 800;
                  color: rgba(107, 114, 128, 0.9);
              }
              
              /* Mobile Responsive */
              @media (max-width: 768px) {
                  .container {
                      margin: 10px;
                  }
                  
                  .event-header, .form-container {
                      padding: 40px 30px;
                  }
                  
                  .event-title {
                      font-size: 28px;
                  }
                  
                  .event-price {
                      font-size: 44px;
                  }
                  
                  .form-row {
                      grid-template-columns: 1fr;
                      gap: 20px;
                  }
                  
                  .input-field {
                      padding: 18px 20px;
                  }
                  
                  .payment-button {
                      padding: 20px;
                      font-size: 16px;
                  }
              }
          </style>
      </head>
      <body>
          <div class="container">
              <a href="${backUrl}" class="back-link">
                  ← Back to Research Summits
              </a>
              
              <div class="payment-card">
                  <div class="event-header">
                      <h1 class="event-title">${event.eventName}</h1>
                      <p class="event-desc">${event.eventDescription}</p>
                      ${customPay ? `<p style="color: #f093fb; font-size: 14px; font-weight: 600; margin-bottom: 15px; position: relative; z-index: 1;">Custom Amount: ${eventCost}</p>` : ''}
                      <div class="event-price">
                          <span class="currency">$</span>${eventCost}
                      </div>
                  </div>
                  
                  <div class="form-container">
                      <form id="payment-form">
                          <div class="form-row">
                              <div class="form-group">
                                  <label class="input-label" for="firstName">First Name</label>
                                  <input type="text" id="firstName" class="input-field" placeholder="John" required>
                              </div>
                              <div class="form-group">
                                  <label class="input-label" for="lastName">Last Name</label>
                                  <input type="text" id="lastName" class="input-field" placeholder="Doe" required>
                              </div>
                          </div>
                          
                          <div class="form-group">
                              <label class="input-label" for="email">Email Address</label>
                              <input type="email" id="email" class="input-field" placeholder="john@university.edu" required>
                          </div>
                          
                          <div class="form-group">
                              <label class="input-label" for="phone">Phone Number</label>
                              <input type="tel" id="phone" class="input-field" placeholder="+1 (555) 123-4567" required>
                          </div>
                          
                          <div class="form-group">
                              <label class="input-label" for="card-element">Card Information</label>
                              <div class="card-container" id="card-container">
                                  <div id="card-element"></div>
                              </div>
                              <div id="card-errors"></div>
                          </div>
                          
                          <button type="submit" class="payment-button" id="payment-button">
                              <span id="button-text">Complete Registration • ${eventCost}</span>
                          </button>
                          
                          <div class="security-info">
                              Your payment is secured with 256-bit SSL encryption by Stripe
                          </div>
                          
                          <div class="footer-credit">
                              Server Operated and Maintained by <strong>Beebotix</strong>
                          </div>
                      </form>
                  </div>
              </div>
          </div>
          
          <div class="loading-overlay" id="loading-overlay">
              <div class="loading-content">
                  <div class="spinner"></div>
                  <div class="loading-text">Processing your registration...</div>
              </div>
          </div>

          <script>
              // Use dynamically loaded publishable key
              const stripe = Stripe('${publishableKey}');
              const elements = stripe.elements();
              
              const cardElement = elements.create('card', {
                  style: {
                      base: {
                          fontSize: '16px',
                          color: '#1e293b',
                          fontFamily: 'Inter, sans-serif',
                          fontWeight: '500',
                          '::placeholder': {
                              color: '#94a3b8',
                              fontWeight: '400',
                          },
                      },
                      invalid: {
                          color: '#ef4444',
                          iconColor: '#ef4444'
                      },
                      complete: {
                          color: '#059669',
                          iconColor: '#059669'
                      }
                  },
                  hidePostalCode: true
              });
              
              cardElement.mount('#card-element');
              
              const cardContainer = document.getElementById('card-container');
              
              cardElement.on('focus', () => cardContainer.classList.add('focused'));
              cardElement.on('blur', () => cardContainer.classList.remove('focused'));
              
              cardElement.on('change', function(event) {
                  const errorElement = document.getElementById('card-errors');
                  if (event.error) {
                      errorElement.innerHTML = '<div class="error-message">' + event.error.message + '</div>';
                  } else {
                      errorElement.innerHTML = '';
                  }
              });
              
              const form = document.getElementById('payment-form');
              const paymentButton = document.getElementById('payment-button');
              const buttonText = document.getElementById('button-text');
              const loadingOverlay = document.getElementById('loading-overlay');
              
              form.addEventListener('submit', async function(event) {
                  event.preventDefault();
                  
                  // Show loading
                  loadingOverlay.style.display = 'flex';
                  
                  const fullName = document.getElementById('firstName').value.trim() + ' ' + document.getElementById('lastName').value.trim();
                  
                  try {
                      const result = await stripe.createToken(cardElement, {
                          name: fullName,
                          email: document.getElementById('email').value.trim(),
                          phone: document.getElementById('phone').value.trim()
                      });
                      
                      if (result.error) {
                          loadingOverlay.style.display = 'none';
                          document.getElementById('card-errors').innerHTML = '<div class="error-message">' + result.error.message + '</div>';
                          return;
                      }
                      
                      const response = await fetch('/process-payment', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                              token: result.token.id,
                              eventId: '${eventId}',
                              name: fullName,
                              email: document.getElementById('email').value.trim(),
                              phone: document.getElementById('phone').value.trim(),
                              amount: ${eventCost * 100}
                          })
                      });
                      
                      const data = await response.json();
                      
                      if (data.success) {
                          sessionStorage.setItem('paymentData', JSON.stringify({
                              chargeId: data.chargeId,
                              eventName: '${event.eventName}',
                              amount: '${eventCost}',
                              customerName: fullName,
                              customerEmail: document.getElementById('email').value.trim()
                          }));
                          
                          window.location.href = '/success';
                      } else {
                          throw new Error(data.error || 'Payment failed');
                      }
                  } catch (err) {
                      loadingOverlay.style.display = 'none';
                      document.getElementById('card-errors').innerHTML = '<div class="error-message">' + err.message + '</div>';
                  }
              });
          </script>
      </body>
      </html>
    `;
    
    res.send(html);
  } catch (error) {
    console.error('Error loading payment page:', error);
    const backUrl = CONFIG?.endpoints?.redirectUrl || 'http://researchsummits.com/index.html';
    res.status(500).send(`
      <html>
        <body style="font-family: 'Inter', sans-serif; text-align: center; padding: 100px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
          <h1>Error Loading Payment Page</h1>
          <p>Unable to load event data. Please try again later.</p>
          <a href="${backUrl}" style="color: #60a5fa; text-decoration: none; font-weight: 600;">← Back to Research Summits</a>
        </body>
      </html>
    `);
  }
});

// ============================================================================
// SUCCESS PAGE ROUTE - ENHANCED AESTHETIC DESIGN
// ============================================================================
app.get('/success', (req, res) => {
  const backUrl = CONFIG?.endpoints?.redirectUrl || 'http://researchsummits.com/index.html';
  
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Registration Successful - Research Summits</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Inter', sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
                min-height: 100vh;
                padding: 20px;
                overflow-x: hidden;
                position: relative;
            }
            
            body::before {
                content: '';
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs><radialGradient id="a" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="%23ffffff" stop-opacity="0.1"/><stop offset="100%" stop-color="%23ffffff" stop-opacity="0"/></radialGradient></defs><circle cx="150" cy="150" r="80" fill="url(%23a)"/><circle cx="850" cy="200" r="120" fill="url(%23a)"/><circle cx="200" cy="800" r="100" fill="url(%23a)"/><circle cx="750" cy="750" r="90" fill="url(%23a)"/><circle cx="500" cy="100" r="60" fill="url(%23a)"/></svg>') no-repeat center center;
                background-size: cover;
                pointer-events: none;
                z-index: -1;
            }
            
            .container {
                max-width: 900px;
                margin: 0 auto;
                padding: 20px 0;
            }
            
            .success-container {
                text-align: center;
                background: rgba(255, 255, 255, 0.98);
                backdrop-filter: blur(25px);
                border-radius: 32px;
                padding: 60px 40px;
                box-shadow: 0 40px 80px rgba(0, 0, 0, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.3);
                width: 100%;
                animation: celebrateEntry 1.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                position: relative;
                overflow: hidden;
            }
            
            .success-container::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 8px;
                background: linear-gradient(90deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
            }
            
            @keyframes celebrateEntry {
                0% { 
                    opacity: 0; 
                    transform: translateY(50px) scale(0.9);
                }
                50% {
                    transform: translateY(-10px) scale(1.02);
                }
                100% { 
                    opacity: 1; 
                    transform: translateY(0) scale(1);
                }
            }
            
            .success-icon {
                width: 120px;
                height: 120px;
                border-radius: 50%;
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                margin: 0 auto 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 60px;
                color: white;
                box-shadow: 0 20px 50px rgba(16, 185, 129, 0.4);
                animation: checkmarkPop 0.8s ease-out 0.5s both;
                position: relative;
            }
            
            .success-icon::before {
                content: '';
                position: absolute;
                width: 100%;
                height: 100%;
                border-radius: 50%;
                background: inherit;
                animation: pulse 2s infinite;
            }
            
            @keyframes checkmarkPop {
                0% { transform: scale(0); }
                50% { transform: scale(1.1); }
                100% { transform: scale(1); }
            }
            
            @keyframes pulse {
                0% { transform: scale(1); opacity: 1; }
                100% { transform: scale(1.3); opacity: 0; }
            }
            
            .success-title {
                font-size: 48px;
                font-weight: 900;
                background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 20px;
                animation: slideInUp 0.8s ease-out 0.7s both;
            }
            
            .success-subtitle {
                font-size: 20px;
                color: #64748b;
                margin-bottom: 40px;
                line-height: 1.7;
                animation: slideInUp 0.8s ease-out 0.9s both;
                font-weight: 500;
            }
            
            @keyframes slideInUp {
                0% { opacity: 0; transform: translateY(30px); }
                100% { opacity: 1; transform: translateY(0); }
            }
            
            .payment-details {
                background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
                border-radius: 24px;
                padding: 35px;
                margin-bottom: 40px;
                border: 2px solid #e2e8f0;
                text-align: left;
                animation: slideInUp 0.8s ease-out 1.1s both;
                box-shadow: 0 10px 30px rgba(0,0,0,0.05);
            }
            
            .detail-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 18px;
                font-size: 16px;
                flex-wrap: wrap;
                gap: 12px;
                padding: 12px 0;
                border-bottom: 1px solid #f1f5f9;
            }
            
            .detail-item:last-child {
                margin-bottom: 0;
                padding-top: 20px;
                border-top: 3px solid #e2e8f0;
                border-bottom: none;
                font-weight: 800;
                font-size: 18px;
            }
            
            .detail-label {
                color: #64748b;
                font-weight: 600;
                min-width: 140px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                font-size: 14px;
            }
            
            .detail-value {
                color: #1e293b;
                font-weight: 700;
                text-align: right;
                word-break: break-word;
            }
            
            .amount-value {
                color: #059669;
                font-size: 24px;
                font-weight: 900;
                text-shadow: 0 2px 4px rgba(5, 150, 105, 0.1);
            }
            
            .action-buttons {
                display: flex;
                gap: 20px;
                justify-content: center;
                flex-wrap: wrap;
                animation: slideInUp 0.8s ease-out 1.3s both;
            }
            
            .btn {
                display: inline-flex;
                align-items: center;
                gap: 12px;
                padding: 18px 32px;
                border-radius: 50px;
                font-weight: 700;
                text-decoration: none;
                font-size: 15px;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                text-transform: uppercase;
                letter-spacing: 1px;
                min-width: 200px;
                justify-content: center;
                position: relative;
                overflow: hidden;
            }
            
            .btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
                transition: left 0.6s;
            }
            
            .btn:hover::before {
                left: 100%;
            }
            
            .btn-primary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
            }
            
            .btn-secondary {
                background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
                color: #374151;
                border: 2px solid #e5e7eb;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);
            }
            
            .btn:hover {
                transform: translateY(-3px);
            }
            
            .btn-primary:hover {
                box-shadow: 0 15px 35px rgba(102, 126, 234, 0.5);
            }
            
            .btn-secondary:hover {
                border-color: #d1d5db;
                background: linear-gradient(135deg, #f9fafb 0%, #ffffff 100%);
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.12);
            }
            
            /* Floating particles animation */
            .particles {
                position: absolute;
                width: 100%;
                height: 100%;
                overflow: hidden;
                pointer-events: none;
                z-index: -1;
            }
            
            .particle {
                position: absolute;
                width: 4px;
                height: 4px;
                background: #f093fb;
                border-radius: 50%;
                animation: float 6s infinite linear;
                opacity: 0.6;
            }
            
            @keyframes float {
                0% { transform: translateY(100vh) rotate(0deg); opacity: 0; }
                10% { opacity: 0.8; }
                90% { opacity: 0.8; }
                100% { transform: translateY(-100px) rotate(360deg); opacity: 0; }
            }
            
            /* Mobile Responsive */
            @media (max-width: 768px) {
                .container {
                    padding: 10px 0;
                }
                
                .success-container {
                    padding: 40px 25px;
                    margin: 0 10px;
                }
                
                .success-title {
                    font-size: 36px;
                }
                
                .success-subtitle {
                    font-size: 18px;
                }
                
                .success-icon {
                    width: 90px;
                    height: 90px;
                    font-size: 45px;
                    margin-bottom: 30px;
                }
                
                .payment-details {
                    padding: 25px;
                }
                
                .detail-item {
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 8px;
                }
                
                .detail-value {
                    text-align: left;
                }
                
                .action-buttons {
                    flex-direction: column;
                    align-items: center;
                }
                
                .btn {
                    width: 100%;
                    max-width: 300px;
                }
            }
        </style>
    </head>
    <body>
        <div class="particles">
            <div class="particle" style="left: 10%; animation-delay: 0s;"></div>
            <div class="particle" style="left: 20%; animation-delay: 1s;"></div>
            <div class="particle" style="left: 30%; animation-delay: 2s;"></div>
            <div class="particle" style="left: 40%; animation-delay: 3s;"></div>
            <div class="particle" style="left: 50%; animation-delay: 4s;"></div>
            <div class="particle" style="left: 60%; animation-delay: 5s;"></div>
            <div class="particle" style="left: 70%; animation-delay: 2.5s;"></div>
            <div class="particle" style="left: 80%; animation-delay: 1.5s;"></div>
            <div class="particle" style="left: 90%; animation-delay: 3.5s;"></div>
        </div>
        
        <div class="container">
            <div class="success-container">
                <div class="success-icon">✓</div>
                
                <h1 class="success-title">Registration Successful!</h1>
                <p class="success-subtitle">
                    🎉 Your conference registration has been processed successfully! You're all set for an outstanding academic experience.
                </p>
                
                <div class="payment-details" id="payment-details">
                    <div class="detail-item">
                        <span class="detail-label">Transaction ID</span>
                        <span class="detail-value" id="transaction-id">#TXN${Date.now()}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Conference</span>
                        <span class="detail-value" id="event-name">Loading...</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Attendee</span>
                        <span class="detail-value" id="customer-name">Loading...</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Payment Status</span>
                        <span class="detail-value" style="color: #059669;">✓ Completed</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Total Amount</span>
                        <span class="detail-value amount-value" id="amount">Loading...</span>
                    </div>
                </div>
                
                <div class="action-buttons">
                    <a href="${backUrl}" class="btn btn-primary">
                        🏠 Browse More Conferences
                    </a>
                    <a href="#" onclick="downloadReceipt()" class="btn btn-secondary">
                        📧 Email Receipt
                    </a>
                </div>
            </div>
        </div>

        <script>
            function loadPaymentData() {
                const paymentData = sessionStorage.getItem('paymentData');
                if (paymentData) {
                    const data = JSON.parse(paymentData);
                    document.getElementById('event-name').textContent = data.eventName;
                    document.getElementById('customer-name').textContent = data.customerName;
                    document.getElementById('amount').textContent = '$' + data.amount;
                    
                    if (data.chargeId) {
                        document.getElementById('transaction-id').textContent = '#' + data.chargeId.slice(-8).toUpperCase();
                    }
                } else {
                    document.getElementById('event-name').textContent = 'Test Conference';
                    document.getElementById('customer-name').textContent = 'Test User';
                    document.getElementById('amount').textContent = '$299';
                }
            }
            
            function downloadReceipt() {
                const paymentData = sessionStorage.getItem('paymentData');
                if (paymentData) {
                    const data = JSON.parse(paymentData);
                    alert('Receipt will be sent to: ' + data.customerEmail + '\\n\\nThis feature requires backend email integration.');
                } else {
                    alert('Receipt will be sent to your email address.');
                }
            }
            
            loadPaymentData();
            
            setTimeout(() => {
                sessionStorage.removeItem('paymentData');
            }, 5000);
        </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

// ============================================================================
// PAYMENT PROCESSING ROUTE
// ============================================================================
app.post('/process-payment', async (req, res) => {
  try {
    const { token, eventId, name, email, phone, amount } = req.body;
    
    if (!token || !eventId || !name || !email || !phone || !amount) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    if (amount < 50) {
      return res.status(400).json({ 
        success: false, 
        error: 'Amount too small' 
      });
    }
    
    const events = await loadEvents();
    const event = events.find(e => e.eventId === eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Conference event not found'
      });
    }
    
    const charge = await stripe.charges.create({
      amount: Math.round(amount),
      currency: 'usd',
      description: `Research Summit Registration: ${event.eventName}`,
      source: token,
      metadata: {
        eventId: eventId,
        eventName: event.eventName,
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        processed_at: new Date().toISOString()
      },
      receipt_email: email,
      statement_descriptor: 'RESEARCH SUMMITS'
    });
    
    if (charge.status === 'succeeded') {
      console.log('✅ Payment successful:', {
        chargeId: charge.id,
        eventId,
        eventName: event.eventName,
        customerName: name,
        customerEmail: email,
        amount: amount / 100,
        timestamp: new Date().toISOString()
      });
      
      res.json({ 
        success: true, 
        chargeId: charge.id,
        receiptUrl: charge.receipt_url
      });
    } else {
      res.status(400).json({ 
        success: false, 
        error: 'Payment was not successful' 
      });
    }
    
  } catch (error) {
    console.error('❌ Payment error:', error);
    
    let errorMessage = 'Payment failed. Please try again.';
    
    if (error.type === 'StripeCardError') {
      errorMessage = error.message;
    } else if (error.type === 'StripeInvalidRequestError') {
      errorMessage = 'Invalid payment information';
    } else if (error.type === 'StripeAPIError') {
      errorMessage = 'Payment service temporarily unavailable';
    }
    
    res.status(400).json({ 
      success: false, 
      error: errorMessage 
    });
  }
});

// ============================================================================
// API ROUTES
// ============================================================================
app.get('/api/events', async (req, res) => {
  try {
    const events = await loadEvents();
    res.json({
      success: true,
      events: events,
      total: events.length
    });
  } catch (error) {
    console.error('❌ Error fetching events:', error);
    res.status(500).json({
      success: false,
      error: 'Unable to fetch conference events'
    });
  }
});

app.get('/api/events/:eventId', async (req, res) => {
  try {
    const events = await loadEvents();
    const event = events.find(e => e.eventId === req.params.eventId);
    
    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Conference event not found'
      });
    }
    
    res.json({
      success: true,
      event: event
    });
  } catch (error) {
    console.error('❌ Error fetching event details:', error);
    res.status(500).json({
      success: false,
      error: 'Unable to fetch conference details'
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Research Summits Payment Gateway',
    version: '1.0.0',
    config: CONFIG ? 'loaded' : 'not_loaded',
    usage: {
      payment_default: '/payment/RS2025AI',
      payment_custom: '/payment/RS2025AI?pay=450',
      events_api: '/api/events',
      event_details: '/api/events/RS2025AI'
    }
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error' 
  });
});

app.use('*', (req, res) => {
  const backUrl = CONFIG?.endpoints?.redirectUrl || 'http://researchsummits.com/index.html';
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>404 - Page Not Found</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          body { 
            font-family: 'Inter', sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; 
            text-align: center; 
            padding: 100px 20px; 
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(20px);
            border-radius: 20px;
            padding: 50px;
            border: 1px solid rgba(255,255,255,0.2);
          }
          h1 { font-size: 72px; margin-bottom: 20px; font-weight: 900; }
          p { font-size: 18px; margin-bottom: 30px; opacity: 0.9; }
          a { 
            color: #60a5fa; 
            text-decoration: none; 
            font-weight: 600;
            padding: 15px 30px;
            border: 2px solid #60a5fa;
            border-radius: 50px;
            transition: all 0.3s ease;
            background: rgba(96,165,250,0.1);
          }
          a:hover { 
            background: #60a5fa; 
            color: white; 
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(96,165,250,0.3);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>404</h1>
          <p>The page you're looking for doesn't exist.</p>
          <a href="${backUrl}">← Back to Research Summits</a>
        </div>
      </body>
    </html>
  `);
});

// ============================================================================
// START SERVER WITH INITIALIZATION
// ============================================================================
const startServer = async () => {
  try {
    // Initialize configuration first
    await initializeApp();
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`🚀 Research Summits Payment Gateway running on http://localhost:${PORT}`);
      console.log(`📱 Home redirects to: ${CONFIG?.endpoints?.redirectUrl || 'http://researchsummits.com/index.html'}`);
      console.log(`💳 Test payment (default): http://localhost:${PORT}/payment/RS2025AI`);
      console.log(`💰 Test payment (custom): http://localhost:${PORT}/payment/RS2025AI?pay=450`);
      console.log(`🔗 Events loaded from: ${CONFIG?.endpoints?.eventsUrl || 'GitHub repository'}`);
      console.log(`🔗 Config loaded from: https://raw.githubusercontent.com/BeeBotix/researchsummits_Webpage/refs/heads/main/stripe-config.json`);
      console.log(`🔑 Stripe keys loaded from GitHub config (TEST MODE)`);
      console.log(`\n🏢 Server Operated and Maintained by Beebotix (http://beebotix.com/)`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the application
startServer();
```
