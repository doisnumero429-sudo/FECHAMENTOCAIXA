plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "br.com.aracaresto.meucaixa"
    compileSdk = 34

    defaultConfig {
        applicationId = "br.com.aracaresto.meucaixa"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        // Identificador do terminal — altere por dispositivo se tiver mais de um
        buildConfigField("String", "TERMINAL_ID", "\"CAIXA\"")
        buildConfigField("String", "SUPABASE_URL", "\"https://qsnxpvzhetrsjjjkvxiz.supabase.co\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzbnhwdnpoZXRyc2pqamt2eGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NTYxODksImV4cCI6MjA5NjUzMjE4OX0.DmSC9fDmDD-Bjylkwubfuqxh6sxLk4Enxbtam3aWDgw\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.8"
    }
}

dependencies {
    // Jetpack Compose
    implementation(platform("androidx.compose:compose-bom:2024.02.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")

    // CameraX
    implementation("androidx.camera:camera-camera2:1.3.1")
    implementation("androidx.camera:camera-lifecycle:1.3.1")
    implementation("androidx.camera:camera-view:1.3.1")

    // Supabase Kotlin SDK
    implementation(platform("io.github.jan-tennert.supabase:bom:2.1.5"))
    implementation("io.github.jan-tennert.supabase:postgrest-kt")
    implementation("io.github.jan-tennert.supabase:storage-kt")
    implementation("io.ktor:ktor-client-android:2.3.8")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
}
