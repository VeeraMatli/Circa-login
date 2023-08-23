package com.circa.project.login.controlller;

import com.circa.project.circacommons.Request.LoginRequest;
import com.circa.project.circacommons.Response.LoginResponse;
import com.circa.project.login.service.LoginService;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;


@Controller
public class LoginController {

    private Logger logger = LogManager.getLogger(LoginController.class);

    @Autowired
    LoginService loginService;

    @PostMapping(value = "/userLogin", consumes = {MediaType.APPLICATION_JSON_VALUE}, produces = {MediaType.APPLICATION_JSON_VALUE})
    public LoginResponse checkUserLogin (@RequestBody LoginRequest loginRequest) {

        return new LoginResponse();
    }
}
