import 'server-only';
import type { OrganizerPrincipal } from '@/types/principal';
import type { Transaction } from './client';
import { unavailable,AppError } from '../errors';
export async function ownedEvent(tx:Transaction,principal:OrganizerPrincipal,eventId:string){
 const [event]=await tx`SELECT id,organizer_id,version,public_id FROM app.events WHERE id=${eventId} AND organizer_id=${principal.userId} AND deleted_at IS NULL FOR UPDATE`;
 if(!event)throw unavailable();return event;
}
export function expectedVersion(actual:number,expected:number){if(actual!==expected)throw new AppError(409,'VERSION_CONFLICT','Данные изменились. Обновите страницу.');}
