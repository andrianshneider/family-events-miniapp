import 'server-only';
import { Temporal } from '@js-temporal/polyfill';
import { AppError } from '../errors';
export function localInstant(date:string,time:string,timezone:string){try{return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(timezone,{disambiguation:'reject'}).toInstant().toString();}catch{throw new AppError(422,'INVALID_LOCAL_TIME','Уточните время: оно неоднозначно или не существует в выбранном часовом поясе.');}}
export function eventTimes(date:string,start:string|null|undefined,end:string|null|undefined,timezone:string,creating=false,now=Temporal.Now.instant()){
 if(creating&&Temporal.PlainDate.compare(Temporal.PlainDate.from(date),now.toZonedDateTimeISO(timezone).toPlainDate())<0)throw new AppError(422,'EVENT_DATE_IN_PAST','Дата события уже прошла.');
 const effectiveAt=localInstant(date,start??'00:00',timezone);return {startsAt:start?effectiveAt:null,endsAt:end?localInstant(date,end,timezone):null,effectiveAt};
}
export function reminderAt(date:string,start:string|null,timezone:string,now=Temporal.Now.instant()){
 const instant=start?Temporal.Instant.from(localInstant(date,start,timezone)).subtract({hours:24}):Temporal.Instant.from(localInstant(Temporal.PlainDate.from(date).subtract({days:1}).toString(),'09:00',timezone));
 return Temporal.Instant.compare(instant,now)>0?instant.toString():null;
}
