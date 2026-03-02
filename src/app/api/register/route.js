import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

export async function POST(req) {
  const body = await req.json()
  const { email, name, password, inviteCode } = body

  if (!email || !name || !password || !inviteCode) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  const invite = await prisma.inviteCode.findUnique({ where: { code: inviteCode } })
  if (!invite || invite.usedAt) {
    return NextResponse.json({ error: 'Invalid or already used invite code' }, { status: 400 })
  }
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Invite code expired' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 400 })
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await prisma.$transaction([
    prisma.user.create({ data: { email, name, passwordHash } }),
    prisma.inviteCode.update({
      where: { code: inviteCode },
      data: { usedAt: new Date(), usedBy: email }
    }),
  ])

  return NextResponse.json({ ok: true })
}
