import { Router, Request, Response } from 'express';
import { authenticateToken, AuthRequest } from '@/middleware/auth';
import { validate, schemas } from '@/middleware/validation';
import { asyncHandler } from '@/middleware/errorHandler';
import { User } from '@/models/User';
import { PromoCode } from '@/models/PromoCode';
import { createCustomer, createSubscription, getStripe, verifyWebhookSignature } from '@/config/stripe';
import Logger from '@/services/logger';
import mongoose from 'mongoose';

const router = Router();

// Create subscription
router.post('/create',
  authenticateToken,
  validate(schemas.createSubscription),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    console.log(`Creating subscription for user ${userId}`);
    console.log(req.user, req.body);
    const { priceId, promoCode } = req.body;
    const user = req.user!.dbUser;
    
    let stripeCustomer;
    if (user.subscription.stripeCustomerId) {
      stripeCustomer = { id: user.subscription.stripeCustomerId };
    } else {
      stripeCustomer = await createCustomer({
        email: user.email,
        name: user.displayName,
        metadata: { userId },
      });
      
      await User.findByIdAndUpdate(userId, {
        'subscription.stripeCustomerId': stripeCustomer.id,
      });
    }
    
    const subscription = await createSubscription(stripeCustomer.id, priceId, 3, userId);
    
    await User.findByIdAndUpdate(userId, {
      'subscription.stripeSubscriptionId': subscription.id,
      'subscription.status': subscription.status === 'trialing' ? 'free_trial' : 'active',
      'subscription.currentPeriodStart': new Date(subscription.current_period_start * 1000),
      'subscription.currentPeriodEnd': new Date(subscription.current_period_end * 1000),
    });
    
    await Logger.logSubscription('subscription_created', userId, {
      subscriptionId: subscription.id,
      customerId: stripeCustomer.id,
      priceId,
      status: subscription.status,
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    }, 'success', req);
    
    res.json({
      success: true,
      data: {
        clientSecret: (subscription.latest_invoice as any)?.payment_intent?.client_secret,
        subscriptionId: subscription.id,
      },
    });
  })
);

// Apply promo code
router.post('/promo-code',
  authenticateToken,
  validate(schemas.applyPromoCode),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { code } = req.body;
    const userId = req.user!.userId;
    
    const promoCode = await PromoCode.findValidCode(code, new mongoose.Types.ObjectId(userId));
    if (!promoCode) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired promo code',
      });
    }
    
    const discountInfo = promoCode.getDiscountInfo();
    
    await Logger.logPromo('promo_code_validated', userId, {
      code,
      promoCodeId: (promoCode._id as mongoose.Types.ObjectId).toString(),
      discount: discountInfo,
    }, 'success', req);

    return res.json({
      success: true,
      data: {
        valid: true,
        discount: discountInfo,
      },
    });
  })
);

// Cancel subscription
router.post('/cancel',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user!.userId;
    const { subscriptionId, cancelAtPeriodEnd = true } = req.body;
    const user = req.user!.dbUser;
    
    if (!user.subscription.stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'No active subscription found',
      });
    }
    
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.update(subscriptionId || user.subscription.stripeSubscriptionId, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });
    
    await User.findByIdAndUpdate(userId, {
      'subscription.status': cancelAtPeriodEnd ? 'canceled' : 'expired',
      'subscription.canceledAt': new Date(),
    });
    
    await Logger.logSubscription('subscription_canceled', userId, {
      subscriptionId: subscriptionId || user.subscription.stripeSubscriptionId,
      cancelAtPeriodEnd,
      reason: 'user_request',
    }, 'success', req);
    
    return res.json({
      success: true,
      message: cancelAtPeriodEnd ? 'Subscription will be canceled at period end' : 'Subscription canceled immediately',
    });
  })
);

// Get subscription details
router.get('/details',
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = req.user!.dbUser;
    
    if (!user.subscription.stripeSubscriptionId) {
      return res.status(404).json({
        success: false,
        error: 'No subscription found',
      });
    }
    
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(user.subscription.stripeSubscriptionId, {
      expand: ['latest_invoice', 'customer'],
    });
    
    return res.json({
      success: true,
      data: {
        subscription: {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
          trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        },
      },
    });
  })
);

// Stripe webhook
router.post('/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'] as string;
    const event = verifyWebhookSignature(req.body, sig);
    
    // Handle different event types
    switch (event.type) {
      case 'customer.subscription.updated':
        {
          const subscription = event.data.object as any;
          const customer = await getStripe().customers.retrieve(subscription.customer);
          
          if (customer && !customer.deleted && customer.metadata?.userId) {
            await User.findByIdAndUpdate(customer.metadata.userId, {
              'subscription.status': subscription.status === 'trialing' ? 'free_trial' : 
                                   subscription.status === 'active' ? 'active' : 
                                   subscription.status === 'canceled' ? 'canceled' : 'expired',
              'subscription.currentPeriodStart': new Date(subscription.current_period_start * 1000),
              'subscription.currentPeriodEnd': new Date(subscription.current_period_end * 1000),
            });

            await Logger.logSubscription('subscription_updated', customer.metadata.userId, {
              subscriptionId: subscription.id,
              status: subscription.status,
              currentPeriodStart: new Date(subscription.current_period_start * 1000),
              currentPeriodEnd: new Date(subscription.current_period_end * 1000),
              cancelAtPeriodEnd: subscription.cancel_at_period_end,
              source: 'stripe_webhook',
            });
          }
        }
        break;
        
      case 'customer.subscription.deleted':
        {
          const subscription = event.data.object as any;
          const customer = await getStripe().customers.retrieve(subscription.customer);
          
          if (customer && !customer.deleted && customer.metadata?.userId) {
            await User.findByIdAndUpdate(customer.metadata.userId, {
              'subscription.status': 'expired',
              'subscription.canceledAt': new Date(),
            });

            await Logger.logSubscription('subscription_deleted', customer.metadata.userId, {
              subscriptionId: subscription.id,
              canceledAt: new Date(),
              source: 'stripe_webhook',
            });
          }
        }
        break;
        
      case 'invoice.payment_succeeded':
        {
          const invoice = event.data.object as any;
          if (invoice.subscription) {
            const subscription = await getStripe().subscriptions.retrieve(invoice.subscription);
            const customer = await getStripe().customers.retrieve(subscription.customer as string);
            
            if (customer && !customer.deleted && customer.metadata?.userId) {
              await User.findByIdAndUpdate(customer.metadata.userId, {
                'subscription.status': 'active',
                'subscription.currentPeriodStart': new Date(subscription.current_period_start * 1000),
                'subscription.currentPeriodEnd': new Date(subscription.current_period_end * 1000),
              });

              await Logger.logPayment('payment_succeeded', customer.metadata.userId, {
                invoiceId: invoice.id,
                subscriptionId: subscription.id,
                amount: invoice.amount_paid,
                currency: invoice.currency,
                source: 'stripe_webhook',
              });
            }
          }
        }
        break;
        
      case 'invoice.payment_failed':
        {
          const invoice = event.data.object as any;
          if (invoice.subscription) {
            const subscription = await getStripe().subscriptions.retrieve(invoice.subscription);
            const customer = await getStripe().customers.retrieve(subscription.customer as string);
            
            if (customer && !customer.deleted && customer.metadata?.userId) {
              await Logger.logPayment('payment_failed', customer.metadata.userId, {
                invoiceId: invoice.id,
                subscriptionId: subscription.id,
                amount: invoice.amount_due,
                currency: invoice.currency,
                attemptCount: invoice.attempt_count,
                nextPaymentAttempt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null,
                source: 'stripe_webhook',
              }, 'failure');
              
              console.log(`Payment failed for user ${customer.metadata.userId}`);
            }
          }
        }
        break;
    }
    
    res.json({ received: true });
  })
);

export default router;
