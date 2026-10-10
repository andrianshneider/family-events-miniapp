import { NextResponse } from 'next/server';
import { endpoint } from '@/server/api';
import { limit } from '@/server/auth/rate-limit';
import { sessionCookie } from '@/server/auth/sessions';
import { startOidc } from '@/server/telegram/oidc';
export const GET=endpoint(async(request)=>{await limit(request,'auth',Number(process.env.AUTH_RATE_LIMIT??10));const {url,state}=await startOidc(new URL(request.url).searchParams.get('returnTo')??'/events');const response=NextResponse.redirect(url);response.headers.set('Cache-Control','no-store');sessionCookie(response,'__Host-fe_oidc',state,600);return response;});
