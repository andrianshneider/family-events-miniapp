export class AppError extends Error {
 constructor(public status:number,public code:string,message:string,public fieldErrors?:Record<string,string[]>){super(message);}
}
export const unavailable=()=>new AppError(404,'EVENT_UNAVAILABLE','Событие недоступно.');
export const unauthenticated=()=>new AppError(401,'AUTH_REQUIRED','Войдите в аккаунт.');
