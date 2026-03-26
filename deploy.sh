#!/bin/bash
set -e
cd /var/www/customs

echo "Building..."
npm run build

echo "Syncing static files to standalone..."
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static

echo "Syncing public..."
rm -rf .next/standalone/public
cp -r public .next/standalone/public

echo "Restarting service..."
systemctl restart customs-calculator

echo "Done."
