import * as React from 'react';
import { DropdownMenu as M } from 'radix-ui';
import { cn } from '@/lib/utils';

const DropdownMenu = M.Root;
const DropdownMenuTrigger = M.Trigger;

function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={sideOffset} className={cn('z-50 min-w-48 rounded-lg border border-border bg-popover p-1 text-sm shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0', className)} {...props} />
    </M.Portal>
  );
}
function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof M.Item>) {
  return <M.Item className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-secondary [&_svg]:size-4 [&_svg]:text-muted-foreground', className)} {...props} />;
}
function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('px-2.5 py-1.5 text-xs text-muted-foreground', className)} {...props} />;
}
function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn('my-1 h-px bg-border', className)} {...props} />;
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator };
