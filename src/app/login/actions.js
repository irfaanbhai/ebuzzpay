'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export async function login(formData) {
    const supabase = await createClient()

    const email = formData.get('email')
    const password = formData.get('password')

    const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
    })

    if (error) {
        console.error('Login Error:', error)
        return { error: error.message }
    }

    revalidatePath('/', 'layout')
    return { success: true }
}

export async function signup(formData) {
    const supabase = await createClient()

    const email = formData.get('email')
    const password = formData.get('password')
    const confirmPassword = formData.get('confirm_password')
    const phone = formData.get('phone')
    const referrer_code = formData.get('referrer_code')

    if (!phone || !/^\d{10}$/.test(phone)) {
        return { error: 'Please enter a valid 10-digit mobile number' }
    }

    if (password !== confirmPassword) {
        return { error: 'Passwords do not match' }
    }

    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                phone,
                referrer_code: referrer_code || null
            }
        }
    })

    if (error) {
        console.error('Signup Error:', error)
        return { error: error.message }
    }

    revalidatePath('/', 'layout')
    return { success: true }
}
