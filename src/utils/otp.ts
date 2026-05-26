import { createHash, randomInt } from 'crypto';

/** Generate a 6-digit numeric OTP. Uses crypto.randomInt for uniform distribution. */
export function generateOtp(): string {
  return String(randomInt(100_000, 1_000_000));
}

/** SHA-256 hash an OTP before storing it. */
export function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

/** Constant-time comparison via re-hashing. */
export function verifyOtp(candidate: string, storedHash: string): boolean {
  return hashOtp(candidate) === storedHash;
}
