import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn  = !!req.auth
  const isAuthPage  = req.nextUrl.pathname.startsWith('/login') ||
                      req.nextUrl.pathname.startsWith('/register')
  const isAdminPage = req.nextUrl.pathname.startsWith('/admin')
  const isAdminUser = req.auth?.user?.role === 'ADMIN'

  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
  if (isAdminPage && !isAdminUser) {
    return NextResponse.redirect(new URL('/', req.url))
  }
  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
