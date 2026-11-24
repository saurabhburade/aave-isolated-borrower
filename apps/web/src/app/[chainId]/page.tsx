import { AppShell } from '@/components/app-shell';
export default async function BorrowPage({ params }: { params: Promise<{ chainId: string }> }) { const { chainId } = await params; return <AppShell chainId={Number(chainId)} section="borrow" />; }
