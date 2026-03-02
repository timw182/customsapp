import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { renderToBuffer } from '@react-pdf/renderer'
import { ShipmentPDF, ExcisePDF } from '@/components/ShipmentPDF'
import React from 'react'

export async function POST(req) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  const component = data.type === 'excise' ? ExcisePDF : ShipmentPDF
  const filename  = data.type === 'excise' ? `excise-${Date.now()}.pdf` : `customs-${Date.now()}.pdf`
  const buffer = await renderToBuffer(React.createElement(component, { data }))

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    }
  })
}
