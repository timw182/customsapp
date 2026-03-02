#!/bin/bash
set -e
cd /var/www/customs
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
systemctl restart customs-calculator
echo "✓ Deployed"
