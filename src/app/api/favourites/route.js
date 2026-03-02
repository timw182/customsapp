import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const favs = await prisma.hSFavourite.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' }
  })
  return NextResponse.json(favs)
}

export async function POST(req) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { hsCode, description, dutyRate, notes } = await req.json()
  const fav = await prisma.hSFavourite.upsert({
    where: { userId_hsCode: { userId: session.user.id, hsCode } },
    update: { description, dutyRate, notes },
    create: { userId: session.user.id, hsCode, description, dutyRate: parseFloat(dutyRate) || 0, notes }
  })
  return NextResponse.json(fav)
}

export async function DELETE(req) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  await prisma.hSFavourite.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
