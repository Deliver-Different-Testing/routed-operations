using RoutedOperations.Core.Application.Dtos.BulkImport.Templates;
using FluentValidation;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace RoutedOperations.Core.Application.Validators
{
    public class TemplateCreateRequestValidator : AbstractValidator<TemplateCreateRequest>
    {
        public TemplateCreateRequestValidator()
        {
            SetRules();
        }

        private void SetRules()
        {
            RuleFor(x => x.Template)
                .NotNull();

            RuleFor(x => x.Template.Name)
                .NotEmpty()
                .MaximumLength(50)
                .When(x => x.Template != null);

            RuleFor(x => x.Template.Mappings)
                .NotEmpty()
                .When(x => x.Template != null);

            RuleForEach(x => x.Template.Mappings)
                .ChildRules(x =>
                {
                    x.RuleFor(c => c.UrgentField)
                        .NotEmpty()
                        .MaximumLength(50);

                    x.RuleFor(c => c.ImportField)
                        .NotEmpty()
                        .MaximumLength(50);
                })
                .When(x => x.Template != null && x.Template.Mappings != null);
        }
    }
}
