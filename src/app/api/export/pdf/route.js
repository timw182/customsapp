import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { renderToBuffer } from '@react-pdf/renderer'
import { ShipmentPDF } from '@/components/ShipmentPDF'
import React from 'react'

export async function POST(req) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  const buffer = await renderToBuffer(React.createElement(ShipmentPDF, { data }))

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="customs-${Date.now()}.pdf"`,
    }
  })
}
