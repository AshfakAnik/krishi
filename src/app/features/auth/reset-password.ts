import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { SessionService } from '../../core/session';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Icon } from '../../shared/ui/icon';

/** The token travels only in the URL (the emailed link) — never typed by
 *  hand, so there is no field for it, just the two password fields. */
@Component({
  selector: 'app-reset-password',
  imports: [ReactiveFormsModule, RouterLink, Alert, FormField, Icon],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPassword {
  private readonly session = inject(SessionService);
  private readonly builder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly token = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('token') ?? '')),
    { initialValue: '' },
  );

  protected readonly attempted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);

  protected readonly form = this.builder.nonNullable.group({
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  });

  protected errorFor(field: 'newPassword' | 'confirmPassword'): string {
    if (!this.attempted()) {
      return '';
    }
    if (field === 'confirmPassword') {
      if (this.form.controls.confirmPassword.hasError('required')) {
        return 'Required.';
      }
      return this.form.getRawValue().confirmPassword !== this.form.getRawValue().newPassword
        ? 'Passwords do not match.'
        : '';
    }
    if (this.form.controls.newPassword.hasError('required')) {
      return 'Required.';
    }
    if (this.form.controls.newPassword.hasError('minlength')) {
      return 'At least 8 characters.';
    }
    return '';
  }

  protected submit(): void {
    this.attempted.set(true);
    const raw = this.form.getRawValue();
    if (this.form.invalid || raw.newPassword !== raw.confirmPassword || this.submitting()) {
      return;
    }
    if (!this.token()) {
      this.error.set('This reset link is missing its token — open the link from your email again.');
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    this.session.resetPassword(this.token(), raw.newPassword).subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigate(['/sign-in']);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(
          err instanceof HttpErrorResponse
            ? ((err.error as { message?: string } | null)?.message ?? 'Could not reset password.')
            : 'Could not reset password.',
        );
      },
    });
  }
}
