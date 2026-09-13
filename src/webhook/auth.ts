import { timingSafeEqual } from 'node:crypto';

const toBuffer = (value: string): Buffer => Buffer.from(value, 'utf8');

export const constantTimeEquals = (left: string, right: string): boolean => {
  const leftBuffer = toBuffer(left);
  const rightBuffer = toBuffer(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const isSourceIpAllowed = (requestIp: string, allowedSourceIps: string[]): boolean => {
  if (allowedSourceIps.length === 0) {
    return true;
  }
  return allowedSourceIps.includes(requestIp);
};
