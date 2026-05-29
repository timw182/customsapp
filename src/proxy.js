import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn  = !!req.auth
  const isAuthPage  = req.nextUrl.pathname.startsWith('/login') ||
                      req.nextUrl.pathname.startsWith('/register')
  // All /api/* routes bypass the middleware — each route handler calls
  // requireUser() or auth() to enforce its own auth requirements.
  const isPublicApi = req.nextUrl.pathname.startsWith('/api/') ||
                      req.nextUrl.pathname === '/' ||
                      req.nextUrl.pathname === '/landing.html' ||
                      req.nextUrl.pathname.startsWith('/preview') ||
                      req.nextUrl.pathname.startsWith('/desktop')
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|mockup.*\\.html|dutify-v.+\\.html).*)'],
}
