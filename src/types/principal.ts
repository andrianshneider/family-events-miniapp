export type OrganizerPrincipal={kind:'organizer';userId:string;sessionId:string};
export type GuestPrincipal={kind:'guest';guestIdentityId:string;sessionId:string};
export type Principal=OrganizerPrincipal|GuestPrincipal;
