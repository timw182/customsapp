import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { renderToBuffer } from '@react-pdf/renderer'
import { ShipmentPDF, ExcisePDF } from '@/components/ShipmentPDF'
import { T1DraftPDF } from '@/components/T1DraftPDF'
import React from 'react'

export async function POST(req) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data = await req.json()

  let component, filename
  if (data.type === 'excise') {
    component = ExcisePDF
    filename = `excise-${Date.now()}.pdf`
  } else if (data.type === 't1') {
    component = T1DraftPDF
    filename = `T1-draft-${Date.now()}.pdf`
  } else {
    component = ShipmentPDF
    filename = `customs-${Date.now()}.pdf`
  }

  const buffer = await renderToBuffer(React.createElement(component, { data }))

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    }
  })
}
