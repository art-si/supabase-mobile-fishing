export function openReportMail(url:string):boolean{
 if(!url.startsWith('mailto:'))return false
 // #ifdef H5
 window.location.href=url
 return true
 // #endif
 // #ifndef H5
 return false
 // #endif
}
