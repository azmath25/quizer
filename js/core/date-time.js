// Date-only parsing helper for result and teacher/student UI.
export function parseDateTime(value){
  if(value===null||value===undefined||value==="")return null;
  let date;
  if(value instanceof Date)date=value;
  else if(typeof value==="string"||typeof value==="number"){
    if(typeof value==="number"&&!Number.isFinite(value))return null;
    date=new Date(value);
  }else if(value&&typeof value==="object"){
    // Defensive fallback for raw Firestore Timestamp JSON; the server
    // normally serializes all timestamps to ISO before returning.
    const seconds=value.seconds??value._seconds;
    const nanos=value.nanoseconds??value._nanoseconds??0;
    if(typeof seconds!=="number"||!Number.isFinite(seconds)||
      !Number.isInteger(seconds)||typeof nanos!=="number"||
      !Number.isInteger(nanos)||nanos<0||nanos>=1000000000)return null;
    date=new Date(seconds*1000+nanos/1000000);
  }else return null;
  return Number.isFinite(date.getTime())?date:null;
}
export function minutesBetweenDates(start,end){
  const a=parseDateTime(start),b=parseDateTime(end);
  if(!a||!b)return null;
  return Math.max(0,Math.round((b.getTime()-a.getTime())/60000));
}
