package com.scholargrid.teacher

import android.app.Application
import com.scholargrid.teacher.sync.AttendanceSyncWorker

class TeacherApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AttendanceSyncWorker.schedulePeriodic(this)
    }
}
