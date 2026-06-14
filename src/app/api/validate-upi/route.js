import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    const { upi_id } = await request.json()

    if (!upi_id || !upi_id.includes('@')) {
      return NextResponse.json(
        { error: 'Invalid UPI ID format' },
        { status: 400 }
      )
    }

    // Razorpay Fund Account Validation API
    const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID
    const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET

    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return NextResponse.json(
        { error: 'Razorpay credentials not configured' },
        { status: 500 }
      )
    }

    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')

    const response = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fund_account: {
          account_type: 'vpa',
          vpa: {
            address: upi_id
          }
        },
        notes: {
          purpose: 'UPI Verification'
        }
      })
    })

    const data = await response.json()

    if (response.ok && data.results?.account_status === 'active') {
      return NextResponse.json({
        valid: true,
        name: data.results.account_name || 'User',
        upi_id: upi_id,
        message: 'UPI verified successfully'
      })
    } else {
      return NextResponse.json({
        valid: false,
        message: data.error?.description || 'Invalid UPI ID or verification failed'
      }, { status: 400 })
    }

  } catch (error) {
    console.error('UPI Validation Error:', error)
    return NextResponse.json(
      { error: 'Failed to validate UPI', details: error.message },
      { status: 500 }
    )
  }
}
