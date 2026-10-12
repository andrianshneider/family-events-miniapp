import { z } from "zod";
import { notFound,redirect } from "next/navigation";
import { organizer } from "@/server/auth/sessions";
import { readWishlist } from "@/server/services/wishlists";
import { AppError } from "@/server/errors";
import { WishlistScreen } from "@/components/wishlist-screen";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{eventId:string}>}) {
 const parsed=z.uuid().safeParse((await params).eventId);if(!parsed.success)notFound();let initial=null;
 try{initial=await readWishlist(parsed.data,{},await organizer());}catch(e){if(e instanceof AppError&&e.status===401)redirect("/login?returnTo="+encodeURIComponent(`/events/${parsed.data}/wishlist`));if(e instanceof AppError&&e.status===404)notFound();}
 return <WishlistScreen key={parsed.data} eventKey={parsed.data} owner initial={initial}/>;
}
