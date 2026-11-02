import * as React from 'react';
import { cn } from '@/lib/utils';

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}
function TableHeader(props: React.ComponentProps<'thead'>) {
  return <thead {...props} />;
}
function TableBody(props: React.ComponentProps<'tbody'>) {
  return <tbody {...props} />;
}
function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr className={cn('border-t border-border transition-colors data-[state=selected]:bg-primary/5 [&:not([data-head])]:hover:bg-muted', className)} {...props} />;
}
function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return <th className={cn('px-4 py-2.5 text-left text-xs font-medium text-muted-foreground', className)} {...props} />;
}
function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
