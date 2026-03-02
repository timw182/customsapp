import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { nanoid } from 'nanoid'

export async function GET() {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const codes = await prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json(codes)
}

export async function POST(req) {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { expiresInDays } = await req.json().catch(() => ({}))
  const code = nanoid(12)
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400000)
    : null
  const invite = await prisma.inviteCode.create({
    data: { code, createdBy: session.user.id, expiresAt }
  })
  return NextResponse.json(invite)
}

export async function DELETE(req) {
  const session = await auth()
  if (session?.user?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await req.json()
  await prisma.inviteCode.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
