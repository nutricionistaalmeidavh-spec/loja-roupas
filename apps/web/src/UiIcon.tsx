import type {ReactNode} from 'react';

export type UiIconName = 'pos'|'shirt'|'boxes'|'wallet'|'chart'|'settings'|'logout'|'plus'|'bag'|'search'|'x';

const shapes:Record<UiIconName,ReactNode>={
 pos:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 13h4M8 16h8"/></>,
 shirt:<><path d="m16 4 4 3 2 5-4 2-2-3v9H8v-9l-2 3-4-2 2-5 4-3c2.2 2.4 5.8 2.4 8 0Z"/></>,
 boxes:<><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></>,
 wallet:<><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18M15 13h6M7 5V3h11"/></>,
 chart:<><path d="M4 20h16M7 17V9M12 17V5M17 17v-6" strokeLinecap="round"/><circle cx="7" cy="7" r="1" fill="currentColor" stroke="none"/></>,
 settings:<><circle cx="12" cy="12" r="3"/><path d="m9.3 3 .5 2.1a7.6 7.6 0 0 0-1.8 1L6 5.2 3.7 9l1.7 1.4a7.8 7.8 0 0 0 0 3.2L3.7 15 6 18.8l2-1a7.6 7.6 0 0 0 1.8 1L9.3 21h5.4l.5-2.2a7.6 7.6 0 0 0 1.8-1l2 1L21.3 15l-1.7-1.4a7.8 7.8 0 0 0 0-3.2L21.3 9 19 5.2l-2 1a7.6 7.6 0 0 0-1.8-1L14.7 3Z"/></>,
 logout:<><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M13 8l4 4-4 4M7 12h10"/></>,
 plus:<path d="M12 5v14M5 12h14" strokeLinecap="round"/>,
 bag:<><path d="M4 8h16l-1 12H5L4 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></>,
 search:<><circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 5 5"/></>,
 x:<path d="M5 5l14 14M19 5 5 19" strokeLinecap="round"/>
};
export function UiIcon({name,size=20}:{name:UiIconName;size?:number}){
 return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
   stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
   {shapes[name]}
 </svg>;
}
