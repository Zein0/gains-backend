import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import crypto from 'crypto';

let s3Client: S3Client;

export const initializeStorage = (): void => {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_ENDPOINT,
  } = process.env;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing required Cloudflare R2 environment variables');
  }

  const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  s3Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  console.log('✅ Cloudflare R2 storage initialized');
};

export const getStorageClient = (): S3Client => {
  if (!s3Client) {
    initializeStorage();
  }
  return s3Client;
};

export interface UploadOptions {
  userId: string;
  type: 'front' | 'side' | 'back' | 'pose' | 'profile';
  date?: string; // YYYY-MM-DD format
  quality?: number; // 1-100
  maxWidth?: number;
  maxHeight?: number;
}

export const uploadImage = async (
  imageBuffer: Buffer,
  options: UploadOptions
): Promise<string> => {
  try {
    const { userId, type, date = new Date().toISOString().split('T')[0], quality = 85, maxWidth = 1920, maxHeight = 1080 } = options;
    
    // Process image with Sharp
    const processedImage = await sharp(imageBuffer)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality,
        progressive: true,
        mozjpeg: true,
      })
      .toBuffer();

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const fileName = `progress/${userId}/${date}/${type}_${timestamp}_${randomString}.jpg`;

    const bucketName = process.env.R2_BUCKET_NAME || 'fitness-tracker-images';
    
    // Upload to R2
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: processedImage,
      ContentType: 'image/jpeg',
      Metadata: {
        userId,
        type,
        date,
        uploadedAt: new Date().toISOString(),
      },
    });

    await s3Client.send(command);

    // Return the public URL
    const publicUrl = `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev/${fileName}`;
    console.log(`✅ Image uploaded successfully: ${publicUrl}`);
    
    return publicUrl;
  } catch (error) {
    console.error('❌ Image upload failed:', error);
    throw new Error('Failed to upload image');
  }
};

export const deleteImage = async (imageUrl: string): Promise<boolean> => {
  try {
    // Extract the key from the URL
    const url = new URL(imageUrl);
    const key = url.pathname.substring(1); // Remove leading slash

    const bucketName = process.env.R2_BUCKET_NAME || 'fitness-tracker-images';
    
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await s3Client.send(command);
    console.log(`✅ Image deleted successfully: ${key}`);
    
    return true;
  } catch (error) {
    console.error('❌ Image deletion failed:', error);
    return false;
  }
};

export const getPresignedUploadUrl = async (
  fileName: string,
  contentType: string = 'image/jpeg',
  expiresIn: number = 3600 // 1 hour
): Promise<string> => {
  try {
    const bucketName = process.env.R2_BUCKET_NAME || 'fitness-tracker-images';
    
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      ContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error('❌ Failed to generate presigned URL:', error);
    throw new Error('Failed to generate upload URL');
  }
};

export const getPresignedDownloadUrl = async (
  fileName: string,
  expiresIn: number = 3600 // 1 hour
): Promise<string> => {
  try {
    const bucketName = process.env.R2_BUCKET_NAME || 'fitness-tracker-images';
    
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileName,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error('❌ Failed to generate presigned download URL:', error);
    throw new Error('Failed to generate download URL');
  }
};

export const generateProgressImageKey = (
  userId: string,
  type: 'front' | 'side' | 'back' | 'pose',
  date: string = new Date().toISOString().split('T')[0]
): string => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  return `progress/${userId}/${date}/${type}_${timestamp}_${randomString}.jpg`;
};

export const generateProfileImageKey = (userId: string): string => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  return `profiles/${userId}/avatar_${timestamp}_${randomString}.jpg`;
};

export const isValidImageUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    // Check if it's from our R2 bucket
    return domain.includes('r2.dev') || domain.includes('cloudflarestorage.com');
  } catch {
    return false;
  }
};

export const extractImageKey = (url: string): string | null => {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.substring(1); // Remove leading slash
  } catch {
    return null;
  }
};

// Cleanup old images (for scheduled tasks)
export const cleanupOldImages = async (olderThanDays: number = 365): Promise<number> => {
  try {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const bucketName = process.env.R2_BUCKET_NAME || 'fitness-tracker-images';
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    let deletedCount = 0;
    let continuationToken: string | undefined;
    
    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: 'progress/',
        ContinuationToken: continuationToken,
      });
      
      const response = await s3Client.send(listCommand);
      
      if (response.Contents) {
        const objectsToDelete = response.Contents.filter(obj => 
          obj.LastModified && obj.LastModified < cutoffDate
        );
        
        if (objectsToDelete.length > 0) {
          const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
          const deleteCommand = new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: {
              Objects: objectsToDelete.map(obj => ({ Key: obj.Key! })),
              Quiet: true,
            },
          });
          
          await s3Client.send(deleteCommand);
          deletedCount += objectsToDelete.length;
        }
      }
      
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
    
    console.log(`🧹 Cleanup completed: deleted ${deletedCount} images older than ${olderThanDays} days`);
    return deletedCount;
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    return 0;
  }
};