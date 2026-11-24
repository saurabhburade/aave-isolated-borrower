'use client';
import {useState} from 'react';
import {Info} from 'lucide-react';
import {Button} from './button';
import {Tooltip,TooltipContent,TooltipTrigger} from './tooltip';

export function InfoTip({label,text}:{label:string;text:string}) {
  const [open,setOpen]=useState(false);
  return <Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger closeOnClick={false} onClick={()=>setOpen(true)} render={<Button type="button" variant="ghost" size="icon-xs" className="stat-info-trigger" aria-label={`About ${label}`} />}><Info aria-hidden="true" /></TooltipTrigger>
    <TooltipContent>{text}</TooltipContent>
  </Tooltip>;
}
