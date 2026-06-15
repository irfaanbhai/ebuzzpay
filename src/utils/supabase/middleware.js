import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

export async function updateSession(request) {
    // Define protected paths
    // Note: '/admin' is intentionally excluded — it has its own password gate
    // and should be reachable without a normal-user Supabase session.
    const protectedPaths = ['/deposit', '/history', '/payment', '/profile', '/teams', '/tool', '/assets']
    const isProtected = protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))

    // If NOT protected, return immediately without Supabase
    if (!isProtected) {
        return NextResponse.next({
            request,
        })
    }

    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        request.cookies.set(name, value)
                    )
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        // no user, redirect to login page
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    return supabaseResponse
}
