import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import AdminPanel from '@/components/AdminPanel'

export default async function AdminPage() {
  const session = await auth()
  if (!session || session.user?.role !== 'ADMIN') redirect('/')
  return <AdminPanel />
}
