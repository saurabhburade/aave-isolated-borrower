export { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Badge, Divider, Dialog } from './compat';
export { buttonVariants } from './button';
export { Input } from './input';
export { Field, FieldLabel, FieldDescription } from './field';
export { InputGroup, InputGroupAddon, InputGroupInput, InputGroupButton } from './input-group';
export { Label } from './label';
export { Skeleton } from './skeleton';
export { MotionButton, type MotionButtonProps } from './motion-button';
export { MotionIcon } from './motion-icon';
export { MotionProvider } from './motion-provider';
export function Token({ symbol, icon }: { symbol: string; icon?: string }) {
  return <span className="token"><span className="token-icon">{icon ?? symbol.slice(0, 1)}</span><strong>{symbol}</strong></span>;
}
