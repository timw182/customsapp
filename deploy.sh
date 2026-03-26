#!/bin/bash
set -e
cd /var/www/customs

echo "Building..."
npm run build

echo "Copying static assets to standalone..."
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

echo "Restarting..."
pm2 restart customs-calculator

echo "Done."
