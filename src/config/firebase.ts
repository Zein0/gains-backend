import admin from 'firebase-admin';
import Logger from '@/services/logger';

let firebaseApp: admin.app.App;

export const initializeFirebase = (): void => {
  try {
    const {
      FIREBASE_PROJECT_ID,
      FIREBASE_PRIVATE_KEY_ID,
      FIREBASE_PRIVATE_KEY,
      FIREBASE_CLIENT_EMAIL,
      FIREBASE_CLIENT_ID,
      FIREBASE_AUTH_URI,
      FIREBASE_TOKEN_URI,
    } = process.env;

    if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY_ID || !FIREBASE_CLIENT_ID) {
      throw new Error('Missing required Firebase environment variables');
    }

    // Parse the private key (handle newlines in environment variable)
    const privateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

    const serviceAccount: admin.ServiceAccount = {
      projectId: FIREBASE_PROJECT_ID,
      privateKey: privateKey,
      clientEmail: FIREBASE_CLIENT_EMAIL,
    };

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log('✅ Firebase Admin initialized successfully');
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
    throw error;
  }
};

export const getFirebaseApp = (): admin.app.App => {
  if (!firebaseApp) {
    throw new Error('Firebase app not initialized. Call initializeFirebase() first.');
  }
  return firebaseApp;
};

export const verifyFirebaseToken = async (idToken: string): Promise<admin.auth.DecodedIdToken> => {
  try {
    const app = getFirebaseApp();
    const decodedToken = await app.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('❌ Firebase token verification failed:', error);
    throw new Error('Invalid or expired token');
  }
};

export const getFirebaseUser = async (uid: string): Promise<admin.auth.UserRecord> => {
  try {
    const app = getFirebaseApp();
    const userRecord = await app.auth().getUser(uid);
    return userRecord;
  } catch (error) {
    console.error('❌ Failed to get Firebase user:', error);
    throw new Error('User not found');
  }
};

export const setCustomClaims = async (uid: string, claims: object): Promise<void> => {
  try {
    const app = getFirebaseApp();
    await app.auth().setCustomUserClaims(uid, claims);
  } catch (error) {
    console.error('❌ Failed to set custom claims:', error);
    throw new Error('Failed to update user claims');
  }
};

export const sendPushNotification = async (
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  userId?: string
): Promise<string> => {
  try {
    const app = getFirebaseApp();
    const message = {
      notification: {
        title,
        body,
      },
      data: data || {},
      token,
    };

    const response = await app.messaging().send(message);
    
    await Logger.logNotification('push_notification_sent', userId || '', {
      title,
      body,
      data,
      messageId: response,
      platform: 'firebase',
    }, 'success');
    
    console.log('✅ Push notification sent successfully:', response);
    return response;
  } catch (error) {
    await Logger.logNotification('push_notification_failed', userId || '', {
      title,
      body,
      data,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'failure');
    
    console.error('❌ Failed to send push notification:', error);
    throw new Error('Failed to send notification');
  }
};

export const sendMulticastNotification = async (
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
  userIds?: string[]
): Promise<admin.messaging.BatchResponse> => {
  try {
    const app = getFirebaseApp();
    const message = {
      notification: {
        title,
        body,
      },
      data: data || {},
      tokens,
    };

    const response = await app.messaging().sendMulticast(message);
    
    await Logger.logNotification('multicast_notification_sent', userIds?.join(',') || '', {
      title,
      body,
      data,
      tokensCount: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses.map(r => ({
        success: r.success,
        messageId: r.messageId,
        error: r.error?.code
      })),
    }, response.failureCount > 0 ? 'failure' : 'success');
    
    console.log(`✅ Multicast notification sent to ${tokens.length} devices:`, response);
    return response;
  } catch (error) {
    await Logger.logNotification('multicast_notification_failed', userIds?.join(',') || '', {
      title,
      body,
      data,
      tokensCount: tokens.length,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 'failure');
    
    console.error('❌ Failed to send multicast notification:', error);
    throw new Error('Failed to send notifications');
  }
};