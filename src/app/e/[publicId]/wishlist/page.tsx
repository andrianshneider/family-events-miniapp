import { notFound } from "next/navigation";
import { readWishlist } from "@/server/services/wishlists";
import { AppError } from "@/server/errors";
import { WishlistScreen } from "@/components/wishlist-screen";
export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{publicId:string}>}) {
 const {publicId}=await params;let initial=null;try{initial=await readWishlist(publicId);}catch(e){if(e instanceof AppError&&e.status===404)notFound();}
 return <WishlistScreen key={publicId} eventKey={publicId} initial={initial}/>;
}
