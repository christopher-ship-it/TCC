// A customer's mobile number is who they are: one record per number, matched on its last 10 digits so "+91 98450
// 12345", "098450 12345" and an incoming caller ID all find the same person.
import type { CustomerUser } from '../data/types.ts';

const tail = (phone: string) => phone.replace(/\D/g, '').slice(-10);

/** The id of a customer added by hand, from the full international digits of their number. */
export const customerIdFor = (digits: string) => `cust-${digits}`;

/** The customer already on file for this number, if any. A real customer beats a dialled-in or caller record. */
export function findByMobile(users: CustomerUser[], digits: string): CustomerUser | undefined {
  const want = digits.slice(-10);
  const hits = users.filter((u) => tail(u.phone) === want);
  return hits.find((u) => !u.adHoc) ?? hits[0];
}
