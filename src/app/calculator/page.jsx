import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import CustomsCalculator from '@/components/CustomsCalculator'

export default async function CalculatorPage() {
  const session = await auth()
  if (!session) redirect('/login')
  return <CustomsCalculator user={session.user} />
}
