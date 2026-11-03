using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Sanadi.Web.Controllers;

[AllowAnonymous]
public class HomeController : Controller
{
    [HttpGet]
    public IActionResult Index() => Redirect("/");

    [HttpGet]
    public IActionResult Error() => View();
}
