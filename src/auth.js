import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import {
  normalizeEmail, isValidEmail, verifyCodeHash, consumeCode,
  bumpAttempts, latestActiveCode, MAX_ATTEMPTS,
} from '@/lib/otp'


export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  providers: [
    // Password sign-in (legacy). Still supported for users who set a password.
    Credentials({
      id: 'credentials',
      name: 'Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })
        if (!user) return null
        if (!user.passwordHash || user.passwordHash === '!otp-only') return null
        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null
        return { id: user.id, email: user.email, name: user.name, role: user.role }
      }
    }),

    // Passwordless OTP sign-in — same 6-digit email codes used by the mobile
    // app. Account creation is iOS-only via /api/auth/register-mobile; this
    // provider is strictly authentication for an existing user. We do NOT
    // upsert here — if the email isn't on file, sign-in fails with the same
    // generic NextAuth credentials error a wrong code would produce.
    Credentials({
      id: 'otp',
      name: 'Email code',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        const email = normalizeEmail(credentials?.email || '')
        const code = (credentials?.code || '').trim()
        if (!isValidEmail(email) || !/^\d{6}$/.test(code)) return null

        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, role: true },
        })
        if (!user) return null

        const row = await latestActiveCode(email)
        if (!row) return null
        if (row.attempts >= MAX_ATTEMPTS) {
          await consumeCode(row.id)
          return null
        }
        const match = await verifyCodeHash(code, row.codeHash)
        if (!match) {
          await bumpAttempts(row.id)
          return null
        }
        await consumeCode(row.id)

        return user
      }
    }),
  ],
  pages: { signIn: '/login' },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id   = user.id
        token.role = user.role
      }
      return token
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id   = token.id
        session.user.role = token.role
      }
      return session
    }
  }
})
