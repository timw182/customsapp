import pkg from '@prisma/client'
import bcrypt from 'bcryptjs'

const { PrismaClient } = pkg

const db = new PrismaClient({
  datasourceUrl: "file:/var/www/customs/data/customs.db"
})

const hash = await bcrypt.hash('changeme123', 12)
await db.user.create({
  data: {
    email: 'admin@customs.local',
    name: 'Admin',
    passwordHash: hash,
    role: 'ADMIN'
  }
})
console.log('Admin created')
await db.$disconnect()
