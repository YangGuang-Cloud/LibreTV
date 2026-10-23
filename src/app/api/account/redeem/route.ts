import { enrollmentRequest } from '@/lib/account-enrollment';
export const runtime = 'nodejs';
export const POST = (req: Request) => enrollmentRequest(req, 'redeem');
