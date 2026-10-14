import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SessionService } from '../../core/session';
import { Alert } from '../../shared/ui/alert';
import { FormField } from '../../shared/ui/form-field';
import { Icon } from '../../shared/ui/icon';

/** Real username/password sign-in against `POST /auth/login` — replaces
 *  the mock's role-then-person picker, which had nothing left to port
 *  (there was no password to check). No role field: role is decided
 *  server-side from the account, never trusted from client input. */
@Component({
  selector: 'app-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, Alert, FormField, Icon],
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.css',
})
export class SignIn {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly builder = inject(FormBuilder);

  protected readonly attempted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly showPassword = signal(false);

  protected readonly form = this.builder.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  protected errorFor(field: 'username' | 'password'): string {
    if (!this.attempted()) {
      return '';
    }
    return this.form.controls[field].hasError('required') ? 'Required.' : '';
  }

  protected submit(): void {
    this.attempted.set(true);
    if (this.form.invalid || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');
    const { username, password } = this.form.getRawValue();

    this.session.login(username, password).subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigate(['/agreements']);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(
          err instanceof HttpErrorResponse
            ? ((err.error as { message?: string } | null)?.message ?? 'Sign-in failed.')
            : 'Sign-in failed.',
        );
      },
    });
  }
}
