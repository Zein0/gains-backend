import Stripe from 'stripe';
import Logger from '../services/logger';

let stripe: Stripe;

export const initializeStripe = (): void => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  
  if (!stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is not defined in environment variables');
  }

  stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
    typescript: true,
  });

  console.log('✅ Stripe initialized successfully');
};

export const getStripe = (): Stripe => {
  if (!stripe) {
    initializeStripe();
  }
  return stripe;
};

export interface CreateCustomerOptions {
  email: string;
  name?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

export const createCustomer = async (options: CreateCustomerOptions): Promise<Stripe.Customer> => {
  try {
    const { email, name, phone, metadata } = options;
    
    const customer = await stripe.customers.create({
      email,
      name,
      phone,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
      },
    });

    await Logger.logPayment('create_customer', metadata?.userId || '', {
      customerId: customer.id,
      email: email,
      name: name,
      phone: phone,
    }, 'success');

    console.log(`✅ Stripe customer created: ${customer.id}`);
    return customer;
  } catch (error) {
    await Logger.logPayment('create_customer', options.metadata?.userId || '', {
      email: options.email,
      name: options.name,
      phone: options.phone,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'failure');
    
    console.error('❌ Failed to create Stripe customer:', error);
    throw new Error('Failed to create customer');
  }
};

export const createSubscription = async (
  customerId: string,
  priceId?: string,
  trialPeriodDays: number = 3,
  userId?: string
): Promise<Stripe.Subscription> => {
  try {
    const finalPriceId = priceId === "price_monthly" ? process.env.STRIPE_PRICE_ID : process.env.STRIPE_YEARLY_PRICE_ID;

    if (!finalPriceId) {
      throw new Error('No price ID provided and STRIPE_PRICE_ID not set');
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: finalPriceId }],
      trial_period_days: trialPeriodDays,
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        trialPeriodDays: trialPeriodDays.toString(),
        createdAt: new Date().toISOString(),
      },
    });

    await Logger.logPayment('create_subscription', userId || '', {
      subscriptionId: subscription.id,
      customerId,
      priceId: finalPriceId,
      trialPeriodDays,
    }, 'success');

    console.log(`✅ Stripe subscription created: ${subscription.id}`);
    return subscription;
  } catch (error) {
    await Logger.logPayment('create_subscription', userId || '', {
      customerId,
      priceId,
      trialPeriodDays,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'failure');
    
    console.error('❌ Failed to create Stripe subscription:', error);
    throw new Error('Failed to create subscription');
  }
};

export const createPaymentIntent = async (
  amount: number,
  currency: string = 'usd',
  customerId?: string,
  metadata?: Record<string, string>
): Promise<Stripe.PaymentIntent> => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount, // amount in cents
      currency,
      customer: customerId,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    await Logger.logPayment('create_payment_intent', metadata?.userId || '', {
      paymentIntentId: paymentIntent.id,
      amount,
      currency,
      customerId,
    }, 'success');

    console.log(`✅ Payment intent created: ${paymentIntent.id}`);
    return paymentIntent;
  } catch (error) {
    await Logger.logPayment('create_payment_intent', metadata?.userId || '', {
      amount,
      currency,
      customerId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'failure');
    
    console.error('❌ Failed to create payment intent:', error);
    throw new Error('Failed to create payment intent');
  }
};

export const cancelSubscription = async (
  subscriptionId: string,
  cancelAtPeriodEnd: boolean = false,
  userId?: string
): Promise<Stripe.Subscription> => {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: cancelAtPeriodEnd,
      metadata: {
        canceledAt: new Date().toISOString(),
        cancelAtPeriodEnd: cancelAtPeriodEnd.toString(),
      },
    });

    if (!cancelAtPeriodEnd) {
      await stripe.subscriptions.cancel(subscriptionId);
    }

    await Logger.logPayment('cancel_subscription', userId || '', {
      subscriptionId,
      cancelAtPeriodEnd,
      customerId: subscription.customer as string,
    }, 'success');

    console.log(`✅ Subscription ${cancelAtPeriodEnd ? 'scheduled for cancellation' : 'canceled'}: ${subscriptionId}`);
    return subscription;
  } catch (error) {
    await Logger.logPayment('cancel_subscription', userId || '', {
      subscriptionId,
      cancelAtPeriodEnd,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'failure');
    
    console.error('❌ Failed to cancel subscription:', error);
    throw new Error('Failed to cancel subscription');
  }
};

export const getSubscription = async (subscriptionId: string): Promise<Stripe.Subscription> => {
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return subscription;
  } catch (error) {
    console.error('❌ Failed to retrieve subscription:', error);
    throw new Error('Subscription not found');
  }
};

export const getCustomer = async (customerId: string): Promise<Stripe.Customer> => {
  try {
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    return customer;
  } catch (error) {
    console.error('❌ Failed to retrieve customer:', error);
    throw new Error('Customer not found');
  }
};

export const updateSubscription = async (
  subscriptionId: string,
  updates: Partial<Stripe.SubscriptionUpdateParams>
): Promise<Stripe.Subscription> => {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      ...updates,
      metadata: {
        ...updates.metadata,
        updatedAt: new Date().toISOString(),
      },
    });

    console.log(`✅ Subscription updated: ${subscriptionId}`);
    return subscription;
  } catch (error) {
    console.error('❌ Failed to update subscription:', error);
    throw new Error('Failed to update subscription');
  }
};

export const applyPromoCode = async (
  subscriptionId: string,
  promoCodeId: string
): Promise<Stripe.Subscription> => {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      promotion_code: promoCodeId,
      metadata: {
        promoCodeApplied: promoCodeId,
        promoCodeAppliedAt: new Date().toISOString(),
      },
    });

    console.log(`✅ Promo code applied to subscription: ${subscriptionId}`);
    return subscription;
  } catch (error) {
    console.error('❌ Failed to apply promo code:', error);
    throw new Error('Failed to apply promo code');
  }
};

export const createPortalSession = async (
  customerId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> => {
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    console.log(`✅ Portal session created for customer: ${customerId}`);
    return portalSession;
  } catch (error) {
    console.error('❌ Failed to create portal session:', error);
    throw new Error('Failed to create portal session');
  }
};

export const verifyWebhookSignature = (
  payload: string | Buffer,
  signature: string,
  secret?: string
): Stripe.Event => {
  try {
    const webhookSecret = secret || process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not configured');
    }

    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    return event;
  } catch (error) {
    console.error('❌ Webhook signature verification failed:', error);
    throw new Error('Invalid webhook signature');
  }
};

export const getPaymentMethods = async (customerId: string): Promise<Stripe.PaymentMethod[]> => {
  try {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    return paymentMethods.data;
  } catch (error) {
    console.error('❌ Failed to retrieve payment methods:', error);
    throw new Error('Failed to retrieve payment methods');
  }
};

export const formatAmount = (amount: number, currency: string = 'usd'): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
};

export const getSubscriptionStatus = (subscription: Stripe.Subscription): {
  status: string;
  isActive: boolean;
  isTrialing: boolean;
  trialEndsAt?: Date;
  currentPeriodEnd: Date;
} => {
  const status = subscription.status;
  const isActive = ['active', 'trialing'].includes(status);
  const isTrialing = status === 'trialing';
  const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : undefined;
  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

  return {
    status,
    isActive,
    isTrialing,
    trialEndsAt,
    currentPeriodEnd,
  };
};