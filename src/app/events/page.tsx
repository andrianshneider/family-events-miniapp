import { organizer } from '@/server/auth/sessions';
import { redirect } from 'next/navigation';
import { AppError } from '@/server/errors';
export const dynamic='force-dynamic';
export default async function Events(){try{await organizer();}catch(e){if(e instanceof AppError&&e.status===401)redirect('/');throw e;}redirect('/02-my-events.html');}
