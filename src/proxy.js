import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn  = !!req.auth
  const isAuthPage  = req.nextUrl.pathname.startsWith('/login') ||
                      req.nextUrl.pathname.startsWith('/register')
  const isPublicApi = req.nextUrl.pathname.startsWith('/api/register') ||
                      req.nextUrl.pathname.startsWith('/api/auth')
  const isAdminPage = req.nextUrl.pathname.startsWith('/admin')
  const isAdminUser = req.auth?.user?.role === 'ADMIN'

  if (isPublicApi) return NextResponse.next()

  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (isAdminPage && !isAdminUser) {
    return NextResponse.redirect(new URL('/', req.url))
  }
  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
