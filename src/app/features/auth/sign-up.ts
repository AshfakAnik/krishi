import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ROLE_LABELS, RoleName } from '../../core/models/common';
import { SessionService } from '../../core/session';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Icon } from '../../shared/ui/icon';

/** Self-service registration. Role is picked here — unlike sign-in, which
 *  never asks for one — because the account does not exist yet; once it
 *  does, the role is fixed on the Party record, never taken from a client
 *  field again (mirrors party-form.ts's role select for the same reason:
 *  RoleName decides what somebody may do). */
@Component({
  selector: 'app-sign-up',
  imports: [ReactiveFormsModule, RouterLink, Alert, FormField, Icon],
  templateUrl: './sign-up.html',
  styleUrl: './sign-up.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignUp {
  private readonly session = inject(SessionService);
  private readonly builder = inject(FormBuilder);

  protected readonly roles: RoleName[] = ['owner', 'sharecropper', 'admin'];
  protected readonly roleLabels = ROLE_LABELS;

  protected readonly attempted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly done = signal('');
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);

  protected readonly form = this.builder.nonNullable.group({
    name: ['', Validators.required],
    username: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
    phone: ['', Validators.required],
    village: ['', Validators.required],
    role: ['owner' as RoleName, Validators.required],
    adminCode: [''],
  });

  protected readonly isAdmin = computed(() => this.form.controls.role.value === 'admin');

  protected errorFor(
    field: 'name' | 'username' | 'email' | 'password' | 'confirmPassword' | 'phone' | 'village' | 'adminCode',
  ): string {
    if (!this.attempted()) {
      return '';
    }
    if (field === 'confirmPassword') {
      if (this.form.controls.confirmPassword.hasError('required')) {
        return 'Required.';
      }
      return this.form.getRawValue().confirmPassword !== this.form.getRawValue().password
        ? 'Passwords do not match.'
        : '';
    }
    if (field === 'adminCode') {
      return this.isAdmin() && this.form.controls.adminCode.value.trim() === '' ? 'Required for an admin account.' : '';
    }
    const control = this.form.controls[field];
    if (control.hasError('required')) {
      return 'Required.';
    }
    if (control.hasError('email')) {
      return 'Enter a valid email address.';
    }
    if (control.hasError('minlength')) {
      return 'At least 8 characters.';
    }
    return '';
  }

  protected submit(): void {
    this.attempted.set(true);
    const raw = this.form.getRawValue();
    const passwordsMatch = raw.password === raw.confirmPassword;
    const adminCodeOk = raw.role !== 'admin' || raw.adminCode.trim() !== '';
    if (this.form.invalid || !passwordsMatch || !adminCodeOk || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.session
      .signup({
        name: raw.name,
        username: raw.username,
        email: raw.email,
        password: raw.password,
        phone: raw.phone,
        village: raw.village,
        role: raw.role,
        adminCode: raw.role === 'admin' ? raw.adminCode : undefined,
      })
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          this.done.set(response.message);
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          this.error.set(
            err instanceof HttpErrorResponse
              ? ((err.error as { message?: string } | null)?.message ?? 'Sign-up failed.')
              : 'Sign-up failed.',
          );
        },
      });
  }
}
